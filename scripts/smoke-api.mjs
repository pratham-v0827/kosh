#!/usr/bin/env node
// End-to-end API smoke test against the LOCAL emulators + dev server (never a real project).
// Usage: pnpm dev:all   (in another terminal)   then   pnpm smoke
// Creates throwaway emulator users and checks the M1 ledger API, including isolation.

const BASE = process.env.APP_BASE_URL ?? 'http://localhost:3000';
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';
const FS = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
const PROJECT = 'demo-kosh';

if (
  !/^(127\.0\.0\.1|localhost):/.test(AUTH) ||
  !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(BASE)
) {
  console.error('Refusing to run: smoke tests only target local emulators and a local dev server.');
  process.exit(2);
}

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${cond ? '' : `  ${extra}`}`);
  if (!cond) failures++;
};

async function emulatorUser() {
  const email = `smoke-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.test`;
  const r = await fetch(
    `http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'emulator-only', returnSecureToken: true }),
    },
  );
  const j = await r.json();
  if (!j.idToken) throw new Error(`emulator sign-up failed: ${JSON.stringify(j)}`);
  return { uid: j.localId, token: j.idToken };
}

const call = async (token, method, path, body) => {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

// Read a doc straight from the emulator as an admin (bypasses rules: emulator "owner" token).
const readDoc = async (path) => {
  const r = await fetch(
    `http://${FS}/v1/projects/${PROJECT}/databases/(default)/documents/${path}`,
    {
      headers: { Authorization: 'Bearer owner' },
    },
  );
  return r.ok ? r.json() : null;
};
const field = (doc, ...keys) =>
  keys.reduce((v, k) => v?.mapValue?.fields?.[k] ?? v?.fields?.[k] ?? v?.[k], doc);
const str = (v) => v?.stringValue ?? v?.integerValue ?? v?.doubleValue ?? null;

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

const alice = await emulatorUser();
const bob = await emulatorUser();

// --- auth ---
check('no token → 401', (await call(null, 'POST', '/api/v1/session')).status === 401);
const s1 = await call(alice.token, 'POST', '/api/v1/session');
check(
  'first session → 201 created',
  s1.status === 201 && s1.body?.created === true,
  JSON.stringify(s1),
);
const s2 = await call(alice.token, 'POST', '/api/v1/session');
check('second session → 200 not created', s2.status === 200 && s2.body?.created === false);
await call(bob.token, 'POST', '/api/v1/session');
const meta = await readDoc(`userMeta/${alice.uid}`);
check(
  'userMeta has loginCount 2 and no email',
  str(field(meta, 'loginCount')) === '2' && !JSON.stringify(meta).includes('@example.test'),
);

// --- add holding ---
const add = await call(alice.token, 'POST', '/api/v1/holdings/manual', {
  instrument: { name: 'Acme Pre-IPO', assetClass: 'UNLISTED' },
  qty: '100',
  price: '200',
  fees: '50',
  tradeDate: '2025-01-10',
  currentPrice: '260',
});
check('add unlisted holding → 201', add.status === 201, JSON.stringify(add.body));
const inst = add.body?.instrumentId;

// --- validation ---
const bad = await call(alice.token, 'POST', '/api/v1/holdings/manual', {
  instrument: { name: '', assetClass: 'GOLD' },
  qty: '0',
  price: 'abc',
  tradeDate: '2999-01-01',
});
check(
  'invalid input → 422 with field errors',
  bad.status === 422 && Object.keys(bad.body?.error?.details?.fields ?? {}).length >= 4,
  JSON.stringify(bad.body),
);

// --- sell more than held ---
const over = await call(alice.token, 'POST', '/api/v1/transactions', {
  type: 'SELL',
  instrumentId: inst,
  tradeDate: today,
  qty: '101',
  price: '300',
});
check(
  'oversell → 422 LEDGER_INVALID',
  over.status === 422 && over.body?.error?.code === 'LEDGER_INVALID',
  JSON.stringify(over.body),
);

// --- sell 40 ---
const sell = await call(alice.token, 'POST', '/api/v1/transactions', {
  type: 'SELL',
  instrumentId: inst,
  tradeDate: today,
  qty: '40',
  price: '300',
  fees: '10',
});
check('sell 40 → 201', sell.status === 201, JSON.stringify(sell.body));

let book = await readDoc(`users/${alice.uid}/book/current`);
const key = `manual|${inst}`;
const h = field(book, 'holdings', key);
// cost per unit 200.5; sold 40 → cost 8,020; proceeds 12,000 − 10 = 11,990 → realised 3,970
check(
  'book: qty 60, realised 3970',
  str(field(h, 'qty')) === '60' && str(field(h, 'realised')) === '3970',
  JSON.stringify(h)?.slice(0, 300),
);
check('book: value 60 × 260 = 15600', str(field(h, 'value')) === '15600');

// --- edit the sell (40 → 30) ---
const edit = await call(alice.token, 'PATCH', `/api/v1/transactions/${sell.body.transactionId}`, {
  type: 'SELL',
  instrumentId: inst,
  tradeDate: today,
  qty: '30',
  price: '300',
  fees: '10',
});
check('edit sell → 200', edit.status === 200, JSON.stringify(edit.body));
book = await readDoc(`users/${alice.uid}/book/current`);
check('book after edit: qty 70', str(field(book, 'holdings', key, 'qty')) === '70');
const old = await readDoc(`users/${alice.uid}/transactions/${sell.body.transactionId}`);
check('old entry kept as "replaced"', str(field(old, 'status')) === 'replaced');

// --- deleting the buy would break the sell ---
const buyId = add.body.transactionId;
const delBuy = await call(alice.token, 'DELETE', `/api/v1/transactions/${buyId}`);
check('deleting the buy under a sell → 422', delBuy.status === 422, JSON.stringify(delBuy.body));

// --- price update ---
const price = await call(
  alice.token,
  'PUT',
  `/api/v1/instruments/${encodeURIComponent(inst)}/price`,
  { price: '275', asOf: today },
);
check('price update → 200', price.status === 200);
book = await readDoc(`users/${alice.uid}/book/current`);
check('book value 70 × 275 = 19250', str(field(book, 'holdings', key, 'value')) === '19250');

// --- isolation: bob cannot touch alice's transactions ---
const steal = await call(bob.token, 'DELETE', `/api/v1/transactions/${edit.body.transactionId}`);
check("bob deleting alice's txn → 404", steal.status === 404, JSON.stringify(steal.body));
const bobBook = await readDoc(`users/${bob.uid}/book/current`);
check('bob has no book', bobBook === null);

// --- delete holding ---
const delH = await call(alice.token, 'DELETE', `/api/v1/holdings/${encodeURIComponent(inst)}`);
check(
  'delete holding → 200 (2 entries voided)',
  delH.status === 200 && delH.body?.removed === 2,
  JSON.stringify(delH.body),
);
book = await readDoc(`users/${alice.uid}/book/current`);
check('book empty after delete', str(field(book, 'totals', 'holdingsCount')) === '0');

console.log(failures ? `\n${failures} check(s) failed` : '\nAll API smoke checks passed');
process.exit(failures ? 1 : 0);
