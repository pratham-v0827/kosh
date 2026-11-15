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
const stealEdit = await call(
  bob.token,
  'PATCH',
  `/api/v1/transactions/${edit.body.transactionId}`,
  {
    type: 'SELL',
    instrumentId: inst,
    tradeDate: today,
    qty: '1',
    price: '1',
  },
);
check("bob editing alice's txn → 404", stealEdit.status === 404, JSON.stringify(stealEdit.body));
const stealHolding = await call(
  bob.token,
  'DELETE',
  `/api/v1/holdings/${encodeURIComponent(inst)}`,
);
check("bob deleting alice's holding → 404", stealHolding.status === 404);
const stealSell = await call(bob.token, 'POST', '/api/v1/transactions', {
  type: 'SELL',
  instrumentId: inst,
  tradeDate: today,
  qty: '1',
  price: '1',
});
check(
  "bob selling alice's holding → 404",
  stealSell.status === 404,
  JSON.stringify(stealSell.body),
);
// SEC-003: a price for an instrument the caller does not hold must not create anything
const stealPrice = await call(
  bob.token,
  'PUT',
  `/api/v1/instruments/${encodeURIComponent(inst)}/price`,
  { price: '1', asOf: today },
);
check(
  "bob pricing alice's instrument → 404, nothing written",
  stealPrice.status === 404 &&
    (await readDoc(`users/${bob.uid}/manualPrices/${encodeURIComponent(inst)}`)) === null,
  JSON.stringify(stealPrice.body),
);
const aliceBookAfter = await readDoc(`users/${alice.uid}/book/current`);
check(
  "alice's book is unchanged by bob's attempts (value 19250, qty 70)",
  str(field(aliceBookAfter, 'holdings', key, 'value')) === '19250' &&
    str(field(aliceBookAfter, 'holdings', key, 'qty')) === '70',
);
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

// =================== M2: prices, FX, refresh, snapshots, daily job ===================
// Uses LIVE public sources (AMFI NAV file, CoinDCX ticker, Frankfurter/ECB). Symbols only.
console.log('\n— M2 (live public price sources) —');
const carol = await emulatorUser();
await call(carol.token, 'POST', '/api/v1/session');

const mf = await call(carol.token, 'POST', '/api/v1/holdings/manual', {
  instrument: {
    name: 'ICICI Prudential Gilt Fund - Direct Growth',
    assetClass: 'MUTUAL_FUND',
    symbol: '120590',
  },
  qty: '100',
  price: '100',
  tradeDate: '2025-01-01',
});
check('add mutual fund (AMFI code 120590) → 201', mf.status === 201, JSON.stringify(mf.body));
const btc = await call(carol.token, 'POST', '/api/v1/holdings/manual', {
  instrument: { name: 'Bitcoin', assetClass: 'CRYPTO', symbol: 'BTC' },
  qty: '0.01',
  price: '6000000',
  tradeDate: '2025-06-01',
});
check('add crypto (BTC) → 201', btc.status === 201);
const aapl = await call(carol.token, 'POST', '/api/v1/holdings/manual', {
  instrument: { name: 'Apple', assetClass: 'US_EQUITY', symbol: 'AAPL' },
  qty: '5',
  price: '180',
  tradeDate: '2025-03-15', // a Saturday → ECB rate of Fri 14 Mar
});
check('add US stock → 201', aapl.status === 201, JSON.stringify(aapl.body));
const aaplTxn = await readDoc(`users/${carol.uid}/transactions/${aapl.body?.transactionId}`);
check(
  'US buy stored in USD with trade-date ECB rate (86.94)',
  str(field(aaplTxn, 'currency')) === 'USD' && str(field(aaplTxn, 'fxRate')) === '86.94',
  JSON.stringify(aaplTxn?.fields)?.slice(0, 200),
);

// M2.1: Indian stocks by exchange ticker. NSE → Yahoo (unofficial); BSE → Alpha Vantage (free
// key, if set) → Yahoo. A BSE listing gets its own instrument id.
const nse = await call(carol.token, 'POST', '/api/v1/holdings/manual', {
  instrument: {
    name: 'Reliance Industries',
    assetClass: 'IN_EQUITY',
    symbol: 'RELIANCE',
    exchange: 'NSE',
  },
  qty: '10',
  price: '1200',
  tradeDate: '2025-02-03',
});
const bse = await call(carol.token, 'POST', '/api/v1/holdings/manual', {
  instrument: {
    name: 'Reliance Industries (BSE)',
    assetClass: 'IN_EQUITY',
    symbol: 'RELIANCE',
    exchange: 'BSE',
  },
  qty: '5',
  price: '1210',
  tradeDate: '2025-02-03',
});
check(
  'NSE and BSE listings are separate instruments',
  nse.body?.instrumentId === 'IN_EQUITY:RELIANCE' &&
    bse.body?.instrumentId === 'IN_EQUITY:BSE:RELIANCE',
  JSON.stringify([nse.body, bse.body]),
);
const badSym = await call(carol.token, 'POST', '/api/v1/holdings/manual', {
  instrument: {
    name: 'x',
    assetClass: 'IN_EQUITY',
    symbol: '../v7/finance/quote?x=',
    exchange: 'NSE',
  },
  qty: '1',
  price: '1',
  tradeDate: '2025-02-03',
});
check(
  'symbol that could alter a provider URL → 422',
  badSym.status === 422,
  JSON.stringify(badSym.body),
);

const r1 = await call(carol.token, 'POST', '/api/v1/refresh');
check(
  'refresh → 200 with snapshot id',
  r1.status === 200 && typeof r1.body?.snapshotId === 'string',
  JSON.stringify(r1.body)?.slice(0, 300),
);
check(
  // Fresh or from the shared cache (AMFI is cached 6 h, CoinDCX 5 min), but never unpriced.
  'mutual fund and crypto have provider prices',
  !r1.body?.unpriced?.includes('MUTUAL_FUND:120590') && !r1.body?.unpriced?.includes('CRYPTO:BTC'),
  JSON.stringify({ sources: r1.body?.sources, unpriced: r1.body?.unpriced }),
);
check(
  'NSE, BSE and US stocks priced with no paid keys (Yahoo unofficial fallback)',
  ['IN_EQUITY:RELIANCE', 'IN_EQUITY:BSE:RELIANCE', 'US_EQUITY:AAPL'].every(
    (id) => !r1.body?.unpriced?.includes(id),
  ),
  JSON.stringify({
    sources: r1.body?.sources,
    unpriced: r1.body?.unpriced,
    problems: r1.body?.problems,
  }),
);
check(
  'providers without a free key are reported as "not configured", not errors',
  (r1.body?.problems ?? []).every((p) => /not configured|disabled|quota/.test(p.message)),
  JSON.stringify(r1.body?.problems),
);

const cbook = await readDoc(`users/${carol.uid}/book/current`);
const mfH = field(cbook, 'holdings', 'manual|MUTUAL_FUND:120590');
check(
  'MF valued from AMFI NAV',
  str(field(mfH, 'price', 'source')) === 'amfi-navall' && Number(str(field(mfH, 'value'))) > 0,
);
check(
  'book has lastRefresh + USD→INR fx',
  !!field(cbook, 'lastRefresh', 'snapshotId') && Number(str(field(cbook, 'fx', 'rate'))) > 50,
);
check(
  'US stock valued in ₹ via Yahoo (unofficial) × FX',
  str(field(cbook, 'holdings', 'manual|US_EQUITY:AAPL', 'price', 'source')) ===
    'yahoo-unofficial' &&
    Number(str(field(cbook, 'holdings', 'manual|US_EQUITY:AAPL', 'value'))) > 0,
);

const snap = await readDoc(`users/${carol.uid}/snapshots/${r1.body?.snapshotId}`);
const rows = field(snap, 'rows')?.arrayValue?.values ?? [];
const rowSources = rows.map((r) => r.mapValue?.fields?.src?.stringValue);
check(
  'snapshot records the provider for every price',
  str(field(snap, 'trigger')) === 'manual' && rows.length === 5 && rowSources.every(Boolean),
  `rows=${rows.length} sources=${rowSources}`,
);
check(
  'unofficial prices are labelled as such in the snapshot',
  rowSources.filter((s) => s === 'yahoo-unofficial').length >= 2,
  String(rowSources),
);
const series = await readDoc(`users/${carol.uid}/series/${today.slice(0, 4)}`);
check("series has today's point", !!field(series, 'd', today));

const r2 = await call(carol.token, 'POST', '/api/v1/refresh');
check(
  'second refresh within 5 min → 429 cooldown',
  r2.status === 429 &&
    r2.body?.error?.code === 'REFRESH_COOLDOWN' &&
    r2.body?.error?.details?.retryAfter > 0,
  JSON.stringify(r2.body),
);

const cachedPrice = await readDoc('prices/MUTUAL_FUND:120590');
check(
  'shared price cache holds no user data',
  !!cachedPrice && !JSON.stringify(cachedPrice).includes(carol.uid),
);
const tracked = await readDoc('trackedInstruments/MUTUAL_FUND:120590');
check(
  'tracked instrument registered without user id',
  !!tracked && !JSON.stringify(tracked).includes(carol.uid),
);

// --- daily job ---
const cron = (auth) =>
  fetch(`${BASE}/api/cron/daily?chain=0`, { headers: auth ? { authorization: auth } : {} });
check('cron without secret → 401', (await cron(null)).status === 401);
const c1 = await cron(`Bearer ${process.env.CRON_SECRET ?? 'local-dev-cron-secret'}`);
const c1b = await c1.json();
check(
  'cron → 200, prices refreshed, users snapshotted',
  c1.status === 200 && c1b.users?.processed >= 1 && c1b.prices?.tracked >= 2,
  JSON.stringify(c1b)?.slice(0, 300),
);
const c2b = await (
  await cron(`Bearer ${process.env.CRON_SECRET ?? 'local-dev-cron-secret'}`)
).json();
check(
  'cron is idempotent per day (second run snapshots nobody)',
  c2b.users?.processed === 0,
  JSON.stringify(c2b.users),
);

// =================== Phase 2 audit regressions (docs/audits/phase2-bugs.md) ===================
console.log('\n— audit regressions —');
const dave = await emulatorUser();
await call(dave.token, 'POST', '/api/v1/session');
const tomorrowIst = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(
  new Date(Date.now() + 86_400_000),
);
const buy = (over) =>
  call(dave.token, 'POST', '/api/v1/holdings/manual', {
    instrument: { name: 'Berkshire Hathaway B', assetClass: 'US_EQUITY', symbol: 'BRK.B' },
    qty: '2',
    price: '400',
    tradeDate: '2025-03-14',
    ...over,
  });
const future = await buy({ tradeDate: tomorrowIst });
check(
  'BUG-002: trade date tomorrow (IST) → 422',
  future.status === 422,
  JSON.stringify(future.body),
);
const huge = await buy({ qty: '1000000000000.5' });
const tooPrecise = await buy({ price: '400.00000000001' });
check(
  'BUG-006: absurd quantity / 11 decimal places → 422',
  huge.status === 422 && tooPrecise.status === 422,
  JSON.stringify([huge.status, tooPrecise.status]),
);
const brk = await buy({});
check(
  'ticker with a dot (BRK.B) → 201, own instrument id',
  brk.status === 201 && brk.body?.instrumentId === 'US_EQUITY:BRK.B',
  JSON.stringify(brk.body),
);

// BUG-008 candidate: two refreshes at the same moment must not both pass the cooldown.
const race = await Promise.all([
  call(dave.token, 'POST', '/api/v1/refresh'),
  call(dave.token, 'POST', '/api/v1/refresh'),
]);
const statuses = race.map((r) => r.status).sort();
check(
  'concurrent refreshes → exactly one 200 and one 429',
  statuses[0] === 200 && statuses[1] === 429,
  JSON.stringify(race.map((r) => [r.status, r.body?.error?.code])),
);
const dbook = await readDoc(`users/${dave.uid}/book/current`);
const brkKey = 'manual|US_EQUITY:BRK.B';
check(
  'BRK.B priced and valued in the book (dot inside a map key)',
  Number(str(field(dbook, 'holdings', brkKey, 'value'))) > 0 &&
    str(field(dbook, 'holdings', brkKey, 'price', 'source')) === 'yahoo-unofficial',
  JSON.stringify(field(dbook, 'holdings', brkKey))?.slice(0, 300),
);

// BUG-005: a manual price entered on the same day as the provider quote must win.
const quoteDay = str(field(await readDoc('prices/US_EQUITY:BRK.B'), 'asOf'))?.slice(0, 10);
const setPrice = await call(
  dave.token,
  'PUT',
  `/api/v1/instruments/${encodeURIComponent('US_EQUITY:BRK.B')}/price`,
  { price: '123.45', asOf: quoteDay },
);
const dbook2 = await readDoc(`users/${dave.uid}/book/current`);
check(
  'BUG-005: same-day manual price overrides the earlier provider quote',
  setPrice.status === 200 &&
    str(field(dbook2, 'holdings', brkKey, 'price', 'source')) === 'manual' &&
    str(field(dbook2, 'holdings', brkKey, 'price', 'price')) === '123.45',
  JSON.stringify({ setPrice, price: field(dbook2, 'holdings', brkKey, 'price') })?.slice(0, 300),
);

// =================== Phase 3 security audit (docs/audits/phase3-security.md) ===================
console.log('\n— security —');
const raw = (path, init = {}) => fetch(`${BASE}${path}`, init);

// --- authentication ---
const unsigned = [
  Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url'),
  Buffer.from(JSON.stringify({ sub: alice.uid, user_id: alice.uid, exp: 4102444800 })).toString(
    'base64url',
  ),
  'x',
].join('.');
const tamperedSig = `${alice.token.split('.').slice(0, 2).join('.')}.AAAA`;
const authStatuses = await Promise.all(
  [null, 'garbage', unsigned.replace(/\.x$/, '.'), tamperedSig].map(
    async (t) => (await call(t, 'POST', '/api/v1/refresh')).status,
  ),
);
check(
  'no token / garbage / malformed tokens → 401',
  authStatuses.every((s) => s === 401),
  String(authStatuses),
);
const basic = await raw('/api/v1/refresh', {
  method: 'POST',
  headers: { Authorization: `Basic ${alice.token}` },
});
check('wrong auth scheme → 401', basic.status === 401);

// --- input handling ---
const frank = await emulatorUser();
await call(frank.token, 'POST', '/api/v1/session');
const mass = await call(frank.token, 'POST', '/api/v1/holdings/manual', {
  instrument: { name: '<img src=x onerror=alert(1)>', assetClass: 'UNLISTED' },
  qty: '1',
  price: '10',
  tradeDate: '2025-01-10',
  // fields a client must never control
  uid: alice.uid,
  accountId: 'zerodha',
  status: 'void',
  source: 'import',
  role: 'admin',
});
const massTxn = await readDoc(`users/${frank.uid}/transactions/${mass.body?.transactionId}`);
check(
  'extra fields are ignored (no mass assignment)',
  mass.status === 201 &&
    str(field(massTxn, 'accountId')) === 'manual' &&
    str(field(massTxn, 'status')) === 'active' &&
    str(field(massTxn, 'source')) === 'manual' &&
    !('uid' in (massTxn?.fields ?? {})) &&
    !('role' in (massTxn?.fields ?? {})),
  JSON.stringify(massTxn?.fields)?.slice(0, 300),
);
const frankMeta = await readDoc(`userMeta/${frank.uid}`);
check('role cannot be self-assigned', str(field(frankMeta, 'role')) === 'user');

const badIds = await Promise.all([
  call(frank.token, 'DELETE', '/api/v1/holdings/%25zz'),
  call(frank.token, 'DELETE', '/api/v1/holdings/UNLISTED%3Aa%2Fb'),
  call(frank.token, 'DELETE', '/api/v1/transactions/a%2Fb'),
  call(frank.token, 'DELETE', '/api/v1/transactions/..%2F..%2Fbook%2Fcurrent'),
  call(frank.token, 'PUT', '/api/v1/instruments/__proto__/price', { price: '1', asOf: today }),
]);
check(
  'malformed or path-like ids → 404, never 500',
  badIds.every((r) => r.status === 404),
  String(badIds.map((r) => r.status)),
);

const big = await raw('/api/v1/transactions', {
  method: 'POST',
  headers: { Authorization: `Bearer ${frank.token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ note: 'x'.repeat(100_000) }),
});
check('oversized body → 413', big.status === 413, String(big.status));

const wrongMethod = await raw('/api/v1/refresh', {
  headers: { Authorization: `Bearer ${frank.token}` },
});
check('GET on a POST-only route → 405', wrongMethod.status === 405, String(wrongMethod.status));

// --- per-user write rate limit (SEC-002): a burst must hit the limit, not the database ---
const frankInst = mass.body?.instrumentId;
let limited = null;
for (let attempt = 0; attempt < 2 && !limited; attempt++) {
  // 34 writes; retried once in case the burst straddled a minute boundary
  for (let i = 0; i < 34 && !limited; i++) {
    const r = await call(
      frank.token,
      'PUT',
      `/api/v1/instruments/${encodeURIComponent(frankInst)}/price`,
      { price: String(10 + i), asOf: today },
    );
    if (r.status === 429) limited = r;
    else if (r.status !== 200) break;
  }
}
check(
  'burst of edits → 429 WRITE_RATE_LIMIT with retryAfter',
  limited?.body?.error?.code === 'WRITE_RATE_LIMIT' && limited.body.error.details?.retryAfter > 0,
  JSON.stringify(limited?.body),
);
const frankPrices = await readDoc(
  `users/${frank.uid}/manualPrices/${encodeURIComponent(frankInst)}`,
);
check(
  'manual price history is bounded (≤ 50 entries)',
  (field(frankPrices, 'history')?.arrayValue?.values?.length ?? 0) <= 50,
);

// --- public surface ---
const healthRes = await raw('/api/health');
const healthBody = await healthRes.json();
check(
  'health: no write counter, cached read-only check',
  healthRes.status === 200 && healthBody.status === 'ok' && !('pings' in healthBody.firestore),
  JSON.stringify(healthBody),
);
const cors = await raw('/api/v1/session', {
  method: 'OPTIONS',
  headers: {
    Origin: 'https://evil.example',
    'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'authorization',
  },
});
check(
  'no CORS access for other origins',
  cors.headers.get('access-control-allow-origin') === null,
  String(cors.headers.get('access-control-allow-origin')),
);
for (const path of ['/', '/sign-in', '/api/health']) {
  const res = await raw(path);
  const csp = res.headers.get('content-security-policy') ?? '';
  check(
    `security headers on ${path}`,
    csp.includes("default-src 'self'") &&
      csp.includes("frame-ancestors 'none'") &&
      csp.includes("object-src 'none'") &&
      res.headers.get('x-content-type-options') === 'nosniff' &&
      res.headers.get('x-frame-options') === 'DENY' &&
      res.headers.get('referrer-policy') === 'strict-origin-when-cross-origin' &&
      res.headers.get('x-powered-by') === null,
    csp.slice(0, 120),
  );
}
const errBody = await call(frank.token, 'POST', '/api/v1/transactions', {
  type: 'SELL',
  instrumentId: 'UNLISTED:does-not-exist',
  tradeDate: today,
  qty: '1',
  price: '1',
});
check(
  'errors carry a code and message only (no stack, paths or ids of others)',
  errBody.status === 404 &&
    !/node_modules|at \w+ \(|\.ts:|firestore|users\//i.test(JSON.stringify(errBody.body)),
  JSON.stringify(errBody.body),
);

// =================== M3: statement imports (preview → confirm → undo) ===================
console.log('\n— M3 imports —');
const { readFileSync } = await import('node:fs');
const sampleCsv = readFileSync(
  new URL('../packages/parsers/fixtures/kosh-csv/sample.csv', import.meta.url),
);
const upload = async (token, bytes, fileName = 'statement.csv', extra = {}) => {
  const form = new FormData();
  form.set('file', new Blob([bytes], { type: 'text/csv' }), fileName);
  for (const [k, v] of Object.entries(extra)) form.set(k, v);
  const r = await fetch(`${BASE}/api/v1/imports`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const gina = await emulatorUser();
const hank = await emulatorUser();
await call(gina.token, 'POST', '/api/v1/session');
await call(hank.token, 'POST', '/api/v1/session');

const formats = await call(gina.token, 'GET', '/api/v1/imports');
check(
  'supported formats listed (kosh.csv)',
  formats.status === 200 && formats.body?.formats?.some((f) => f.id === 'kosh.csv'),
  JSON.stringify(formats.body)?.slice(0, 200),
);
check('import upload without a token → 401', (await upload('garbage', sampleCsv)).status === 401);

const unknown = await upload(gina.token, Buffer.from('hello,world\n1,2\n'));
check(
  'unknown file → 422 UNKNOWN_FORMAT listing supported formats',
  unknown.status === 422 &&
    unknown.body?.error?.code === 'UNKNOWN_FORMAT' &&
    unknown.body?.error?.details?.supported?.length >= 1,
  JSON.stringify(unknown.body)?.slice(0, 200),
);

const SECRET = 'Sm0ke-Pdf-Passw0rd';
const prev = await upload(gina.token, sampleCsv, 'holder-A-Person-AB1234.csv', {
  password: SECRET,
});
check(
  'upload → 201 preview: 9 new, 0 duplicate, 5 new holdings',
  prev.status === 201 &&
    prev.body?.counts?.new === 9 &&
    prev.body?.counts?.duplicate === 0 &&
    prev.body?.counts?.newHoldings === 5 &&
    prev.body?.parser === 'kosh.csv@1.0.0',
  JSON.stringify(prev.body?.counts ?? prev.body),
);
const importId = prev.body?.importId;
const draftDoc = await readDoc(`users/${gina.uid}/imports/${importId}`);
const draftJson = JSON.stringify(draftDoc ?? {});
check(
  'draft stores neither the password nor the file name',
  str(field(draftDoc, 'status')) === 'draft' &&
    !draftJson.includes(SECRET) &&
    !draftJson.includes('A-Person') &&
    !draftJson.includes('AB1234'),
);
check(
  'nothing reaches the ledger before confirm',
  (await readDoc(`users/${gina.uid}/book/current`)) === null,
);

check(
  "another user cannot confirm or discard someone's import → 404",
  (await call(hank.token, 'POST', `/api/v1/imports/${importId}/confirm`, {})).status === 404 &&
    (await call(hank.token, 'DELETE', `/api/v1/imports/${importId}`)).status === 404,
);

const conf = await call(gina.token, 'POST', `/api/v1/imports/${importId}/confirm`, {});
check(
  'confirm → 200, 9 rows added',
  conf.status === 200 && conf.body?.added === 9 && conf.body?.skippedDuplicates === 0,
  JSON.stringify(conf.body),
);
const gbook = await readDoc(`users/${gina.uid}/book/current`);
// Reliance: buy 10 → split 1:2 = 20 → sell 4 = 16
check(
  'book after import: Reliance 16 units, 5 holdings',
  str(field(gbook, 'holdings', 'import:kosh|IN_EQUITY:RELIANCE', 'qty')) === '16' &&
    str(field(gbook, 'totals', 'holdingsCount')) === '5',
  JSON.stringify(field(gbook, 'totals'))?.slice(0, 200),
);
check(
  'identical rows in one file are both kept (two equal SIP buys = 50.246 units)',
  str(field(gbook, 'holdings', 'import:kosh|MUTUAL_FUND:120590', 'qty')) === '50.246',
  JSON.stringify(field(gbook, 'holdings', 'import:kosh|MUTUAL_FUND:120590', 'qty')),
);
const doneDoc = await readDoc(`users/${gina.uid}/imports/${importId}`);
check(
  'import record: confirmed, rows dropped, counts kept',
  str(field(doneDoc, 'status')) === 'confirmed' &&
    !('rows' in (doneDoc?.fields ?? {})) &&
    str(field(doneDoc, 'added')) === '9',
  JSON.stringify(Object.keys(doneDoc?.fields ?? {})),
);
check(
  'confirming twice → 409',
  (await call(gina.token, 'POST', `/api/v1/imports/${importId}/confirm`, {})).status === 409,
);

// --- de-duplication: the same statement again adds nothing ---
const again = await upload(gina.token, sampleCsv);
check(
  're-upload of the same file → 0 new, 9 duplicate',
  again.status === 201 && again.body?.counts?.new === 0 && again.body?.counts?.duplicate === 9,
  JSON.stringify(again.body?.counts ?? again.body),
);
const againConfirm = await call(
  gina.token,
  'POST',
  `/api/v1/imports/${again.body?.importId}/confirm`,
  {},
);
check(
  'confirming a file with nothing new → 422 NOTHING_TO_IMPORT',
  againConfirm.status === 422 && againConfirm.body?.error?.code === 'NOTHING_TO_IMPORT',
  JSON.stringify(againConfirm.body),
);
check(
  'discard a draft → 200',
  (await call(gina.token, 'DELETE', `/api/v1/imports/${again.body?.importId}`)).body?.discarded ===
    true && (await readDoc(`users/${gina.uid}/imports/${again.body?.importId}`)) === null,
);

// --- imported rows are managed by their import ---
const importedRow = prev.body?.rows?.[0];
const gTxns = await fetch(
  `http://${FS}/v1/projects/${PROJECT}/databases/(default)/documents/users/${gina.uid}/transactions?pageSize=50`,
  { headers: { Authorization: 'Bearer owner' } },
).then((r) => r.json());
const importedDoc = gTxns.documents?.find(
  (d) => d.fields?.fingerprint?.stringValue === importedRow?.fingerprint,
);
const importedTxnId = importedDoc?.name?.split('/').pop();
check(
  'imported transaction carries source, fingerprint, import id and parser',
  importedDoc?.fields?.source?.stringValue === 'import' &&
    importedDoc?.fields?.importId?.stringValue === importId &&
    importedDoc?.fields?.parser?.stringValue === 'kosh.csv@1.0.0' &&
    importedDoc?.fields?.accountId?.stringValue === 'import:kosh',
  JSON.stringify(importedDoc?.fields)?.slice(0, 300),
);
check(
  'deleting an imported transaction directly → 409 NOT_EDITABLE',
  (await call(gina.token, 'DELETE', `/api/v1/transactions/${importedTxnId}`)).status === 409,
);

// --- undo ---
const undo = await call(gina.token, 'DELETE', `/api/v1/imports/${importId}`);
const gbook2 = await readDoc(`users/${gina.uid}/book/current`);
check(
  'undo → 9 transactions voided, book empty, history kept',
  undo.status === 200 &&
    undo.body?.voided === 9 &&
    str(field(gbook2, 'totals', 'holdingsCount')) === '0' &&
    str(field(await readDoc(`users/${gina.uid}/imports/${importId}`), 'status')) === 'undone' &&
    str(field(await readDoc(`users/${gina.uid}/transactions/${importedTxnId}`), 'status')) ===
      'void',
  JSON.stringify(undo.body),
);
check(
  'undoing twice → 409',
  (await call(gina.token, 'DELETE', `/api/v1/imports/${importId}`)).status === 409,
);
const afterUndo = await upload(gina.token, sampleCsv);
check(
  'after an undo the same file is importable again (9 new)',
  afterUndo.body?.counts?.new === 9 && afterUndo.body?.counts?.duplicate === 0,
  JSON.stringify(afterUndo.body?.counts ?? afterUndo.body),
);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll API smoke checks passed');
process.exit(failures ? 1 : 0);
