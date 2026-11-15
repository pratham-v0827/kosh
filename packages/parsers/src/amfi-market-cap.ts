import { type Cell, cellText, isBlankRow, labelKey, type Workbook } from './sheets';

/**
 * AMFI's half-yearly list of listed companies ranked by six-month average market cap
 * (https://www.amfiindia.com/otherdata/categorisation-of-stocks). SEBI's rule: ranks 1–100 are
 * large cap, 101–250 mid cap, 251 onwards small cap. Kosh keeps only the top 250, since every other
 * Indian share is small cap by that definition.
 *
 * Layout checked against the 30 June 2026 file on 2026-11-15. Columns are found by name; anything
 * unexpected (a missing column, a gap in the ranks, a category that breaks the rule) throws, so a
 * changed format is noticed instead of producing a wrong table.
 */

/** [ISIN, NSE symbol, BSE symbol, company name]; position in the list = rank − 1. */
export type AmfiCompany = [isin: string, nse: string | null, bse: string | null, name: string];

export interface AmfiMarketCapList {
  /** Last day of the six-month period, YYYY-MM-DD. */
  asOf: string;
  /** Companies in the whole list. */
  listed: number;
  /** Ranks 1–250. */
  top250: AmfiCompany[];
}

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];
const ISIN = /^IN[A-Z0-9]{9}[0-9]$/;

function periodEnd(text: string): string | null {
  const m = /ended\s+(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+),?\s+(\d{4})/i.exec(text);
  if (!m) return null;
  const month = MONTHS.indexOf(m[2]!.toLowerCase()) + 1;
  const day = Number(m[1]);
  if (month === 0 || day < 1) return null;
  const date = new Date(Date.UTC(Number(m[3]), month - 1, day));
  if (date.getUTCMonth() !== month - 1) return null; // 31 June and the like
  return date.toISOString().slice(0, 10);
}

function symbol(c: Cell): string | null {
  if (!c) return null;
  if (c.t === 'n') return Number.isInteger(c.v) && c.v > 0 ? String(c.v) : null;
  const s = cellText(c);
  return s === '' || s === '-' ? null : s.toUpperCase();
}

const expected = (rank: number) => (rank <= 100 ? 'largecap' : rank <= 250 ? 'midcap' : 'smallcap');

export function readAmfiMarketCap(wb: Workbook): AmfiMarketCapList {
  for (const sheet of wb.sheets) {
    // Header row: the one naming the rank, ISIN, both symbols and the category.
    let header = -1;
    const col: Record<'rank' | 'name' | 'isin' | 'nse' | 'bse' | 'cat', number> = {
      rank: -1,
      name: -1,
      isin: -1,
      nse: -1,
      bse: -1,
      cat: -1,
    };
    for (let r = 0; r < Math.min(sheet.rows.length, 20) && header < 0; r++) {
      const keys = (sheet.rows[r] ?? []).map((c) => labelKey(cellText(c)));
      const at = (test: (k: string) => boolean) => keys.findIndex(test);
      const found = {
        rank: at((k) => k === 'srno' || k === 'rank'),
        name: at((k) => k.startsWith('companyname')),
        isin: at((k) => k === 'isin' || k === 'isincode'),
        nse: at((k) => k === 'nsesymbol'),
        bse: at((k) => k === 'bsesymbol'),
        cat: at((k) => k.startsWith('categori')),
      };
      if (Object.values(found).every((i) => i >= 0)) {
        header = r;
        Object.assign(col, found);
      }
    }
    if (header < 0) continue;

    let asOf: string | null = null;
    for (let r = 0; r < header && !asOf; r++) {
      for (const c of sheet.rows[r] ?? []) asOf ??= periodEnd(cellText(c));
    }
    if (!asOf) throw new Error('AMFI list: no "six months ended <date>" title above the table');

    const top250: AmfiCompany[] = [];
    let listed = 0;
    for (let r = header + 1; r < sheet.rows.length; r++) {
      const row = sheet.rows[r];
      if (isBlankRow(row)) break;
      const rankCell = row![col.rank];
      if (!rankCell || rankCell.t !== 'n') break; // a note under the table
      const rank = rankCell.v;
      if (rank !== listed + 1)
        throw new Error(`AMFI list: expected rank ${listed + 1}, found ${rank}`);
      listed = rank;
      const isin = cellText(row![col.isin]).toUpperCase();
      if (!ISIN.test(isin)) throw new Error(`AMFI list: rank ${rank} has no valid ISIN`);
      const cat = labelKey(cellText(row![col.cat]));
      if (cat !== expected(rank)) {
        throw new Error(
          `AMFI list: rank ${rank} is categorised "${cat}", expected ${expected(rank)}`,
        );
      }
      if (rank <= 250) {
        top250.push([
          isin,
          symbol(row![col.nse]!),
          symbol(row![col.bse]!),
          cellText(row![col.name]),
        ]);
      }
    }
    if (listed < 250) throw new Error(`AMFI list: only ${listed} companies, expected at least 250`);
    return { asOf, listed, top250 };
  }
  throw new Error('AMFI list: no sheet has the expected columns (rank, ISIN, symbols, category)');
}
