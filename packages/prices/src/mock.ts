/**
 * MOCK market data for end-to-end tests and recorded walkthroughs: a stand-in `fetch` that answers
 * every provider Kosh calls (Yahoo chart and search, AMFI, mfapi, Frankfurter, CoinDCX) with
 * INVENTED, deterministic data, so a run never touches a third-party service and shows the same
 * values every day. Never used unless KOSH_MOCK_PRICES=true on an emulator setup (see the web
 * app's emulator guard); every quote it produces still goes through the real parsers.
 *
 * - The latest price of each instrument is fixed (MOCK_PRICES, or one derived from its symbol).
 * - Histories are a smooth made-up curve ending at that price TODAY (anchored to the current day,
 *   so values do not drift from day to day; dates on charts do).
 * - USD→INR is a constant 88.25 on every date.
 * - Tickers starting with ZZ, and ISINs the table does not know, are "not found".
 */

/** Latest prices of the instruments in Kosh's invented fixtures (Yahoo symbol → price). */
export const MOCK_PRICES: Record<string, number> = {
  // Groww fixture (NSE) and the CSV sample
  'BPCL.NS': 341.85,
  'HEROMOTOCO.NS': 4689.4,
  'HINDALCO.NS': 611.9,
  'ITC.NS': 438.6,
  'JSWSTEEL.NS': 971.35,
  'SBIN.NS': 742.15,
  'ADANIPORTS.NS': 1402.7,
  'GRASIM.NS': 2688.05,
  'BRITANNIA.NS': 4987.75,
  'SETFNIF50.NS': 263.37,
  'LIQUIDBEES.NS': 1000.01,
  'RELIANCE.NS': 1450,
  'TCS.NS': 3120.5,
  // INDmoney fixture (US) and the CSV sample
  ORCL: 182.4,
  ADBE: 418.9,
  GS: 521.3,
  DIS: 109.75,
  NKE: 74.6,
  'BF-B': 41.2,
  HD: 384.1,
  META: 612.35,
  T: 25.4,
  BA: 186.2,
  AAPL: 231.5,
  // Benchmark indices
  '^NSEI': 24512.35,
  '^BSESN': 80534.1,
  '^GSPC': 6104.25,
};

/** ISIN → NSE ticker and name for the Groww fixture's holdings. */
export const MOCK_ISINS: Record<string, { symbol: string; name: string }> = {
  INE029A01011: { symbol: 'BPCL', name: 'Bharat Petroleum Corporation Limited' },
  INE158A01026: { symbol: 'HEROMOTOCO', name: 'Hero MotoCorp Limited' },
  INE038A01020: { symbol: 'HINDALCO', name: 'Hindalco Industries Limited' },
  INE154A01025: { symbol: 'ITC', name: 'ITC Limited' },
  INE019A01038: { symbol: 'JSWSTEEL', name: 'JSW Steel Limited' },
  INE062A01020: { symbol: 'SBIN', name: 'State Bank of India' },
  INE742F01042: { symbol: 'ADANIPORTS', name: 'Adani Ports and Special Economic Zone Limited' },
  INE047A01021: { symbol: 'GRASIM', name: 'Grasim Industries Limited' },
  INE216A01030: { symbol: 'BRITANNIA', name: 'Britannia Industries Limited' },
  INF200KA1FS1: { symbol: 'SETFNIF50', name: 'SBI Nifty 50 ETF' },
  INF732E01037: { symbol: 'LIQUIDBEES', name: 'Nippon India ETF Nifty 1D Rate Liquid BeES' },
};

/** Mutual-fund NAVs by AMFI scheme code. */
export const MOCK_NAVS: Record<string, { nav: number; name: string; isin: string }> = {
  '120590': {
    nav: 102.3456,
    name: 'ICICI Prudential Gilt Fund - Direct Plan - Growth',
    isin: 'INF109K01Z48',
  },
};

/** Crypto, CoinDCX INR markets. */
export const MOCK_CRYPTO: Record<string, { last: number; change24h: number }> = {
  BTCINR: { last: 7_512_340, change24h: 1.25 },
  ETHINR: { last: 268_450, change24h: -0.8 },
};

export const MOCK_USD_INR = 88.25;

const DAY = 86_400_000;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Latest price of a symbol: the table, else 50…2,050 derived from the symbol. */
export function mockPrice(symbol: string): number {
  return MOCK_PRICES[symbol] ?? 50 + (hash(symbol) % 200_000) / 100;
}

/** Price `k` days before today, as a share of today's: about +10 % a year with gentle waves. */
function factor(symbol: string, k: number): number {
  const seed = (hash(symbol) % 628) / 100;
  return Math.exp((-0.1 * k) / 365) * (1 + 0.05 * (Math.sin(k / 23 + seed) - Math.sin(seed)));
}

const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;

/** Weekdays (UTC) from `days` days ago up to today, oldest first, as day offsets k (0 = today). */
function weekdaysBack(today: number, days: number): number[] {
  const out: number[] = [];
  for (let k = days; k >= 0; k--) {
    const wd = new Date(today - k * DAY).getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(k);
  }
  return out;
}

const startOfUtcDay = (now: Date) =>
  Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const ddmmyyyy = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getUTCDate()).padStart(2, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${d.getUTCFullYear()}`;
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ddMonyyyy = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getUTCDate()).padStart(2, '0')}-${MONTHS[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
};

/** Last weekday on or before `ms` (UTC). */
function lastWeekday(ms: number): number {
  let t = startOfUtcDay(new Date(ms));
  while ([0, 6].includes(new Date(t).getUTCDay())) t -= DAY;
  return t;
}

function yahooChart(symbol: string, range: string, now: Date): Response {
  if (symbol.startsWith('ZZ')) {
    return json(
      { chart: { result: null, error: { code: 'Not Found', description: 'No data found' } } },
      404,
    );
  }
  const indian =
    symbol.endsWith('.NS') || symbol.endsWith('.BO') || symbol === '^NSEI' || symbol === '^BSESN';
  const base = mockPrice(symbol.endsWith('.BO') ? `${symbol.slice(0, -3)}.NS` : symbol);
  const today = startOfUtcDay(now);
  const span = { '5d': 7, '1mo': 31, '1y': 366, '10y': 3653 }[range] ?? 7;
  const ks = weekdaysBack(today, span);
  // 15:00 UTC is the same calendar day in Kolkata (20:30) and New York (10:00 or 11:00).
  const timestamp = ks.map((k) => Math.floor((today - k * DAY + 15 * 3_600_000) / 1000));
  const close = ks.map((k) => round(base * factor(symbol, k), 2));
  const last = ks.at(-1) === 0 ? close.at(-1)! : round(base, 2);
  return json({
    chart: {
      result: [
        {
          meta: {
            currency: indian ? 'INR' : 'USD',
            symbol,
            exchangeTimezoneName: indian ? 'Asia/Kolkata' : 'America/New_York',
            regularMarketPrice: last,
            regularMarketTime: Math.floor(
              Math.min(now.getTime(), lastWeekday(now.getTime()) + 15 * 3_600_000) / 1000,
            ),
            chartPreviousClose: close[0],
          },
          timestamp,
          indicators: { quote: [{ close }] },
        },
      ],
      error: null,
    },
  });
}

function yahooSearch(q: string): Response {
  const hit = MOCK_ISINS[q];
  return json({
    quotes: hit ? [{ symbol: `${hit.symbol}.NS`, shortname: hit.name, longname: hit.name }] : [],
  });
}

function mfapi(path: string, now: Date): Response {
  const m = /^\/mf\/(\d{4,7})(\/latest)?$/.exec(path);
  const fund = m ? MOCK_NAVS[m[1]!] : undefined;
  if (!m || !fund) return json({ status: 'ERROR', data: [] });
  const today = startOfUtcDay(now);
  const ks = m[2] ? [weekdaysBack(today, 3).at(-1)!] : weekdaysBack(today, 3653);
  const data = ks
    .map((k) => ({
      date: ddmmyyyy(today - k * DAY),
      nav: (fund.nav * factor(m[1]!, k)).toFixed(4),
    }))
    .reverse(); // newest first, as mfapi sends it
  return json({
    meta: { scheme_code: Number(m[1]), scheme_name: fund.name },
    data,
    status: 'SUCCESS',
  });
}

function amfiNavAll(now: Date): Response {
  const date = ddMonyyyy(lastWeekday(now.getTime()));
  const lines = [
    'Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date',
    '',
    'Open Ended Schemes(Debt Scheme - Gilt Fund)',
    '',
    ...Object.entries(MOCK_NAVS).map(
      ([code, f]) => `${code};${f.isin};-;${f.name};${f.nav.toFixed(4)};${date}`,
    ),
    '',
  ];
  return new Response(lines.join('\r\n'), {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  });
}

function frankfurter(path: string, now: Date): Response {
  const m = /^\/v1\/(latest|\d{4}-\d{2}-\d{2})$/.exec(path);
  if (!m) return json({ message: 'not found' }, 404);
  const asked = m[1] === 'latest' ? now.getTime() : Date.parse(`${m[1]}T00:00:00Z`);
  const date = new Date(lastWeekday(Math.min(asked, now.getTime()))).toISOString().slice(0, 10);
  return json({ amount: 1, base: 'USD', date, rates: { INR: MOCK_USD_INR } });
}

function coindcx(now: Date): Response {
  return json(
    Object.entries(MOCK_CRYPTO).map(([market, t]) => ({
      market,
      last_price: String(t.last),
      change_24_hour: String(t.change24h),
      timestamp: Math.floor(now.getTime() / 1000),
    })),
  );
}

/** A `fetch` that answers Kosh's market-data requests with invented data. Anything else: 404. */
export function createMockFetch(clock: () => Date = () => new Date()): typeof fetch {
  const mock = async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const now = clock();
    switch (url.hostname) {
      case 'query1.finance.yahoo.com': {
        const chart = /^\/v8\/finance\/chart\/(.+)$/.exec(url.pathname);
        if (chart) {
          return yahooChart(
            decodeURIComponent(chart[1]!),
            url.searchParams.get('range') ?? '5d',
            now,
          );
        }
        if (url.pathname === '/v1/finance/search')
          return yahooSearch(url.searchParams.get('q') ?? '');
        break;
      }
      case 'api.mfapi.in':
        return mfapi(url.pathname, now);
      case 'portal.amfiindia.com':
      case 'www.amfiindia.com':
        if (url.pathname.endsWith('/NAVAll.txt')) return amfiNavAll(now);
        break;
      case 'api.frankfurter.dev':
        return frankfurter(url.pathname, now);
      case 'api.coindcx.com':
        if (url.pathname === '/exchange/ticker') return coindcx(now);
        break;
    }
    return json({ error: 'not mocked' }, 404);
  };
  return mock as typeof fetch;
}
