#!/usr/bin/env node
// Seed a demo account with FAKE holdings into the LOCAL emulators through the real API.
// Usage: pnpm dev:all   (other terminal)   then   pnpm seed [email]
// Then sign in on http://localhost:3000/sign-in with the same email (email link from the
// emulator; the link is printed in the `pnpm dev:all` output and shown in the emulator UI).

const BASE = process.env.APP_BASE_URL ?? 'http://localhost:3000';
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';
const email = process.argv[2] ?? 'demo@example.test';

if (
  !/^(127\.0\.0\.1|localhost):/.test(AUTH) ||
  !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(BASE)
) {
  console.error('Refusing to run: seeding only targets local emulators and a local dev server.');
  process.exit(2);
}
if (!email.endsWith('.test') && !email.endsWith('@example.com')) {
  console.error('Use a reserved test address (…@example.test) so no real inbox is involved.');
  process.exit(2);
}

const signUp = await fetch(
  `http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'emulator-only-demo', returnSecureToken: true }),
  },
).then((r) => r.json());
if (!signUp.idToken) {
  console.error(
    `Could not create ${email} (already seeded? restart the emulators to reset):`,
    signUp.error?.message,
  );
  process.exit(1);
}
const token = signUp.idToken;

async function call(method, path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(j)}`);
  return j;
}

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const daysAgo = (n) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(
    new Date(Date.now() - n * 86_400_000),
  );

await call('POST', '/api/v1/session');

const holdings = [
  // Mutual fund: priced automatically from the AMFI NAV file
  {
    instrument: {
      name: 'ICICI Prudential Gilt Fund - Direct Growth',
      assetClass: 'MUTUAL_FUND',
      symbol: '120590',
    },
    qty: '250',
    price: '98.40',
    tradeDate: '2024-12-02',
  },
  // Crypto: priced from the CoinDCX INR market
  {
    instrument: { name: 'Bitcoin', assetClass: 'CRYPTO', symbol: 'BTC' },
    qty: '0.015',
    price: '6250000',
    fees: '120',
    tradeDate: '2025-06-10',
  },
  // US stock in USD (FX looked up for the trade date); manual price unless a Finnhub key is set
  {
    instrument: { name: 'Apple Inc.', assetClass: 'US_EQUITY', symbol: 'AAPL' },
    qty: '8',
    price: '171.50',
    fees: '1.20',
    tradeDate: '2025-03-14',
    currentPrice: '228.10',
  },
  // Indian stocks: NSE → Yahoo (unofficial); BSE → Alpha Vantage (free key) → Yahoo
  {
    instrument: {
      name: 'Reliance Industries',
      assetClass: 'IN_EQUITY',
      symbol: 'RELIANCE',
      exchange: 'NSE',
    },
    qty: '20',
    price: '1205',
    fees: '35',
    tradeDate: '2024-08-19',
  },
  {
    instrument: {
      name: 'Tata Consultancy Services',
      assetClass: 'IN_EQUITY',
      symbol: 'TCS',
      exchange: 'BSE',
    },
    qty: '5',
    price: '3890',
    fees: '20',
    tradeDate: '2025-01-06',
  },
  // Unlisted share: manual indicative price (made 45 days old below → stale badge)
  {
    instrument: { name: 'Acme Technologies (pre-IPO)', assetClass: 'UNLISTED' },
    qty: '100',
    price: '245.50',
    fees: '120',
    tradeDate: '2025-03-15',
    currentPrice: '310',
  },
];

const ids = [];
for (const h of holdings) {
  const r = await call('POST', '/api/v1/holdings/manual', h);
  ids.push(r.instrumentId);
  console.log(`added ${h.instrument.name}`);
}

// A partial sale with realised gain, and a manual price that is 45 days old (stale).
await call('POST', '/api/v1/transactions', {
  type: 'SELL',
  instrumentId: ids[5],
  tradeDate: daysAgo(20),
  qty: '30',
  price: '300',
});
await call('PUT', `/api/v1/instruments/${encodeURIComponent(ids[5])}/price`, {
  price: '310',
  asOf: daysAgo(45),
});

const refresh = await call('POST', '/api/v1/refresh');
console.log(
  `refreshed: sources ${JSON.stringify(refresh.sources)}; unpriced ${refresh.unpriced.length}`,
);
console.log(`\nSeeded ${email} on ${today}. Sign in at ${BASE}/sign-in with that email.`);
