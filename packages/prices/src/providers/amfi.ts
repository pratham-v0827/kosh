import { getJson, getText, isDecimal, istCloseIso, parseIndianDate } from '../http';
import type { PriceProvider, PriceTarget, Quote } from '../types';

/**
 * AMFI daily NAV file (official, public). One download covers every scheme.
 * Format (verified 2026-11-09): semicolon-separated with 8 columns:
 *   Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Plan;Option;Net Asset Value;Date
 * interleaved with blank and section-header lines.
 */
export const AMFI_URL = 'https://portal.amfiindia.com/spages/NAVAll.txt';

export interface NavRow {
  code: string;
  isins: string[];
  name: string;
  nav: string;
  date: string; // YYYY-MM-DD
}

export function parseNavAll(text: string): Map<string, NavRow> {
  const byKey = new Map<string, NavRow>();
  const lines = text.split(/\r?\n/);
  const header = lines.find((l) => l.startsWith('Scheme Code;'));
  if (!header) throw new Error('AMFI NAV file: header not found (format changed?)');
  const cols = header.split(';').map((c) => c.trim().toLowerCase());
  const iNav = cols.indexOf('net asset value');
  const iDate = cols.indexOf('date');
  const iName = cols.indexOf('scheme name');
  if (iNav < 0 || iDate < 0 || iName < 0) throw new Error('AMFI NAV file: unexpected columns');

  for (const line of lines) {
    const parts = line.split(';');
    if (parts.length !== cols.length || !/^\d+$/.test(parts[0]!.trim())) continue;
    const nav = parts[iNav]!.trim();
    const date = parseIndianDate(parts[iDate]!);
    if (!isDecimal(nav) || !date) continue; // "N.A." etc.
    const row: NavRow = {
      code: parts[0]!.trim(),
      isins: [parts[1], parts[2]]
        .map((s) => s?.trim() ?? '')
        .filter((s) => /^INF[A-Z0-9]{9}$/.test(s)),
      name: parts[iName]!.trim(),
      nav,
      date,
    };
    byKey.set(row.code, row);
    for (const isin of row.isins) byKey.set(isin, row);
  }
  return byKey;
}

const supportsMf = (t: PriceTarget) =>
  t.assetClass === 'MUTUAL_FUND' &&
  (/^\d{4,7}$/.test(t.symbol) || /^INF[A-Z0-9]{9}$/.test(t.symbol));

// The file is ~1.5 MB and changes once a day: keep a parsed copy for 10 minutes per warm
// server instance so simultaneous refreshes download it once.
const MEMO_MS = 10 * 60_000;
const memo = new WeakMap<typeof fetch, { at: number; rows: Map<string, NavRow> }>();

export const amfiNavProvider: PriceProvider = {
  id: 'amfi-navall',
  label: 'AMFI daily NAV file',
  assetClasses: ['MUTUAL_FUND'],
  supports: supportsMf,
  async fetch(targets, ctx) {
    const hit = memo.get(ctx.fetch);
    let rows: Map<string, NavRow>;
    if (hit && ctx.now.getTime() - hit.at < MEMO_MS) {
      rows = hit.rows;
    } else {
      rows = parseNavAll(await getText('amfi-navall', AMFI_URL, ctx, 30_000));
      memo.set(ctx.fetch, { at: ctx.now.getTime(), rows });
    }
    const out = new Map<string, Quote>();
    for (const t of targets) {
      const r = rows.get(t.symbol);
      if (r) {
        out.set(t.instrumentId, {
          instrumentId: t.instrumentId,
          price: r.nav,
          currency: 'INR',
          asOf: istCloseIso(r.date),
          source: 'amfi-navall',
          delayed: false,
        });
      }
    }
    return out;
  },
};

/** mfapi.in: community mirror of AMFI data (fallback; SLA unverified). Scheme codes only. */
export const mfapiProvider: PriceProvider = {
  id: 'mfapi',
  label: 'mfapi.in (community AMFI mirror)',
  assetClasses: ['MUTUAL_FUND'],
  supports: (t) => t.assetClass === 'MUTUAL_FUND' && /^\d{4,7}$/.test(t.symbol),
  async fetch(targets, ctx) {
    const out = new Map<string, Quote>();
    for (const t of targets) {
      const j = await getJson<{ status?: string; data?: { date: string; nav: string }[] }>(
        'mfapi',
        `https://api.mfapi.in/mf/${encodeURIComponent(t.symbol)}/latest`,
        ctx,
      );
      const d = j.data?.[0];
      const date = d ? parseIndianDate(d.date) : null;
      if (j.status === 'SUCCESS' && d && date && isDecimal(d.nav)) {
        out.set(t.instrumentId, {
          instrumentId: t.instrumentId,
          price: d.nav,
          currency: 'INR',
          asOf: istCloseIso(date),
          source: 'mfapi',
          delayed: false,
        });
      }
    }
    return out;
  },
};
