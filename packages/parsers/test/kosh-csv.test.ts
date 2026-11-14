import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ImportError, koshCsvParser, MAX_IMPORT_ROWS, type ParserInput, runImport } from '../src';

const ctx = { today: '2026-11-14', maxRows: MAX_IMPORT_ROWS };
const enc = (s: string) => new TextEncoder().encode(s);
const file = (text: string, fileName = 'x.csv'): ParserInput => ({ bytes: enc(text), fileName });
const fixture = (...p: string[]) => readFileSync(resolve(import.meta.dirname, '../fixtures', ...p));

const HEADER =
  'date,type,asset_class,name,symbol,exchange,quantity,price,fees,amount,ratio,fx_rate,reference,note';
const one = (row: string) => koshCsvParser.parse(file(`${HEADER}\n${row}\n`), ctx);
const code = (fn: () => unknown) => {
  try {
    fn();
    return 'ok';
  } catch (e) {
    return e instanceof ImportError ? e.code : 'other';
  }
};

describe('kosh.csv detection', () => {
  it('is sure about its own fixture and template', () => {
    const sample: ParserInput = { bytes: fixture('kosh-csv', 'sample.csv'), fileName: 'a.csv' };
    expect(koshCsvParser.detect(sample)).toBeGreaterThanOrEqual(0.8);
    const template = readFileSync(
      resolve(import.meta.dirname, '../../../apps/web/public/templates/kosh-import-template.csv'),
    );
    expect(koshCsvParser.detect({ bytes: template, fileName: 't.csv' })).toBeGreaterThanOrEqual(
      0.8,
    );
  });

  it('does not claim other files', () => {
    const others = [
      'trade_date,symbol,isin,quantity,price,order_id\n2024-01-01,INFY,INE009A01021,1,1500,1\n',
      'date,type,name\n2024-01-01,buy,Something\n',
      '{"chart":{"result":[]}}',
      'just some words\n',
      '',
    ];
    for (const text of others) expect(koshCsvParser.detect(file(text))).toBeLessThan(0.2);
    const binary = {
      bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0, 1, 2, 3]),
      fileName: 'a.pdf',
    };
    expect(koshCsvParser.detect(binary)).toBe(0);
  });

  it('a generic sheet with only the four common columns is below the threshold', () => {
    expect(koshCsvParser.detect(file('date,type,asset_class,name\n'))).toBeLessThan(0.8);
  });
});

describe('kosh.csv parsing', () => {
  const sample = runImport({ bytes: fixture('kosh-csv', 'sample.csv'), fileName: 'my.csv' }, ctx);

  it('normalises the whole fixture (snapshot)', () => {
    expect(sample.parser).toBe('kosh.csv@1.0.0');
    expect(sample.totalRows).toBe(9);
    expect(sample.issues).toEqual([]);
    expect(sample.rows).toMatchSnapshot();
  });

  it('maps each kind of row', () => {
    const [buy, , , us, dividend, split, sell, crypto, unlisted] = sample.rows;
    expect(buy).toEqual({
      line: 2,
      instrument: {
        assetClass: 'IN_EQUITY',
        name: 'Reliance Industries',
        symbol: 'RELIANCE',
        exchange: 'NSE',
      },
      type: 'BUY',
      tradeDate: '2024-04-01',
      currency: 'INR',
      qty: '10',
      price: '2900.5',
      fees: '15.2',
      brokerRef: 'ORD-1001',
      note: 'First lot',
    });
    expect(us).toMatchObject({ tradeDate: '2024-06-14', currency: 'USD', fxRate: '83.45' });
    expect(dividend).toMatchObject({ type: 'DIVIDEND', amount: '100' });
    expect(dividend).not.toHaveProperty('qty');
    expect(split).toMatchObject({ type: 'SPLIT', ratio: { from: 1, to: 2 } });
    expect(sell).toMatchObject({ type: 'SELL', qty: '4', price: '1520' }); // "1,520.00" quoted
    expect(crypto).toMatchObject({ qty: '0.00012345', price: '5500000' });
    expect(unlisted?.instrument).toEqual({
      assetClass: 'UNLISTED',
      name: 'Acme Technologies (pre-IPO), Series A',
    });
  });

  it('accepts a byte-order mark, mixed-case headers and friendly asset-class names', () => {
    const text =
      '\uFEFFDate,Type,Asset Class,Name,Symbol,Quantity,Price,Fx Rate,Reference\r\n' +
      '2024-01-05,BUY,Indian stocks,Infosys,infy,2,1500,,\r\n';
    const out = runImport(file(text), ctx);
    expect(out.issues).toEqual([]);
    expect(out.rows[0]).toMatchObject({
      instrument: { assetClass: 'IN_EQUITY', name: 'Infosys', symbol: 'INFY' },
      qty: '2',
    });
  });

  it('reports bad rows as issues and keeps the good ones', () => {
    const text = [
      HEADER,
      '2024-04-01,buy,in_equity,Good Co,GOOD,NSE,1,10,,,,,,',
      '2999-01-01,buy,in_equity,Future Co,FUT,NSE,1,10,,,,,,',
      '2024-04-01,gift,in_equity,Odd Type,ODD,NSE,1,10,,,,,,',
      '2024-04-01,buy,gold,Odd Class,GLD,,1,10,,,,,,',
      '2024-04-01,buy,in_equity,No Qty,NQ,NSE,,10,,,,,,',
      '2024-04-01,buy,in_equity,Formula,FRM,NSE,=1+1,10,,,,,,',
      '2024-04-01,sell,in_equity,Negative,NEG,NSE,-5,10,,,,,,',
      '2024-04-01,buy,in_equity,Bad Symbol,../v7/quote?x=,NSE,1,10,,,,,,',
      '2024-04-01,buy,us_equity,Wrong Exchange,AAPL,NSE,1,10,,,,,,',
      '2024-04-01,dividend,in_equity,No Amount,NA,NSE,,,,,,,,',
      '2024-04-01,split,in_equity,Bad Ratio,BR,NSE,,,,,1-2,,,',
      '2024-04-01,buy,in_equity,Huge,HUGE,NSE,99999999999999,10,,,,,,',
      'not-a-date,buy,in_equity,Bad Date,BD,NSE,1,10,,,,,,',
    ].join('\n');
    const out = runImport(file(text), ctx);
    expect(out.totalRows).toBe(13);
    expect(out.rows.map((r) => r.instrument.name)).toEqual(['Good Co']);
    const byLine = Object.fromEntries(out.issues.map((i) => [i.line, i.field]));
    expect(byLine).toEqual({
      3: 'date',
      4: 'type',
      5: 'asset_class',
      6: 'quantity',
      7: 'quantity',
      8: 'quantity',
      9: 'symbol',
      10: 'exchange',
      11: 'amount',
      12: 'ratio',
      13: 'quantity',
      14: 'date',
    });
    // messages are advice, never an echo of the cell
    expect(JSON.stringify(out.issues)).not.toContain('=1+1');
    expect(JSON.stringify(out.issues)).not.toContain('../v7');
  });

  it('ignores an fx_rate on rupee rows and a stray amount on a buy', () => {
    const out = one('2024-04-01,buy,in_equity,Reliance,RELIANCE,NSE,1,10,,555,,83,,');
    expect(out.rows[0]).not.toHaveProperty('fxRate');
    expect(out.rows[0]).not.toHaveProperty('amount');
  });

  it('refuses files that are not usable at all', () => {
    expect(code(() => runImport(file('date,type,name\n2024-01-01,buy,X\n'), ctx))).toBe(
      'UNKNOWN_FORMAT',
    );
    expect(code(() => koshCsvParser.parse(file('date,type,quantity,fx_rate\n'), ctx))).toBe(
      'MISSING_COLUMNS',
    );
    const many = `${HEADER}\n${'2024-04-01,buy,in_equity,Co,CO,NSE,1,10,,,,,,\n'.repeat(6)}`;
    expect(code(() => runImport(file(many), { ...ctx, maxRows: 5 }))).toBe('TOO_MANY_ROWS');
    expect(runImport(file(many), { ...ctx, maxRows: 6 }).rows).toHaveLength(6);
  });
});
