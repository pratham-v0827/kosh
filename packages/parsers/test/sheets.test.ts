// Spreadsheet readers: values only, hard limits, and a clear error for anything unreadable.
import { describe, expect, it } from 'vitest';
import {
  type Cell,
  DEFAULT_SHEET_LIMITS,
  ImportError,
  readWorkbook,
  type SheetLimits,
  sniffContainer,
} from '../src';
import { cellText, findHeaderRow, isBlankRow, labelKey, valueBeside } from '../src/sheets';
import { decodeEntities, scanXml } from '../src/sheets/xml';
import { biffWorkbook, compoundFile, writeXls } from './support/write-xls';
import { writeXlsx, zip } from './support/write-xlsx';

const values = (rows: Cell[][]) => rows.map((r) => r.map((c) => (c ? c.v : null)));
const limits = (o: Partial<SheetLimits>): SheetLimits => ({ ...DEFAULT_SHEET_LIMITS, ...o });
const code = (fn: () => unknown) => {
  try {
    fn();
    return 'ok';
  } catch (e) {
    return e instanceof ImportError ? e.code : `not-an-import-error: ${(e as Error).message}`;
  }
};
const patched = (bytes: Uint8Array, edit: (b: Buffer) => void): Uint8Array => {
  const copy = Buffer.from(bytes);
  edit(copy);
  return new Uint8Array(copy);
};
const NOISY = 0.1 + 0.2; // 0.30000000000000004, the kind of number exports are full of

describe('sniffContainer', () => {
  it('recognises containers by their first bytes, not by name', () => {
    expect(sniffContainer(writeXlsx([{ name: 'S', rows: [['a']] }]))).toBe('xlsx');
    expect(sniffContainer(writeXls([{ name: 'S', rows: [['a']] }]))).toBe('xls');
    expect(sniffContainer(new TextEncoder().encode('%PDF-1.7 …'))).toBe('pdf');
    expect(sniffContainer(new TextEncoder().encode('date,type\n'))).toBe('other');
    expect(sniffContainer(new Uint8Array())).toBe('other');
  });

  it('readWorkbook refuses anything that is not a spreadsheet', () => {
    expect(code(() => readWorkbook(new TextEncoder().encode('just text')))).toBe(
      'UNSUPPORTED_FILE',
    );
  });
});

describe('.xlsx reader', () => {
  const rows = [['Name', 12.5, true, null, 'x'], [], ['a&b <c> "q"', NOISY]];

  it.each([
    ['deflated', {}],
    ['stored', { store: true }],
    ['without cell references', { omitRefs: true }],
    ['with a namespace prefix', { prefix: true }],
  ])('reads text, numbers, booleans and gaps (%s)', (_label, options) => {
    const wb = readWorkbook(writeXlsx([{ name: 'Sheet1', rows }], options));
    expect(wb.format).toBe('xlsx');
    expect(wb.sheets[0]!.name).toBe('Sheet1');
    expect(values(wb.sheets[0]!.rows)).toEqual([
      ['Name', 12.5, true, null, 'x'],
      [],
      ['a&b <c> "q"', 0.30000000000000004],
    ]);
  });

  it('reads several sheets and marks hidden ones', () => {
    const wb = readWorkbook(
      writeXlsx([
        { name: 'Visible', rows: [['a']] },
        { name: 'Secret', rows: [['b']], hidden: true },
      ]),
    );
    expect(wb.sheets.map((s) => [s.name, s.hidden])).toEqual([
      ['Visible', false],
      ['Secret', true],
    ]);
  });

  it('reads inline and rich text, uses stored formula results, treats errors as empty', () => {
    const wb = readWorkbook(
      writeXlsx([
        {
          name: 'S',
          rows: [
            [{ inline: 'typed in place' }, { rich: ['Hel', 'lo'] }],
            [
              { formula: 'A1*2', result: 42 },
              { formula: 'CONCAT(A1)', result: 'text' },
            ],
            [{ error: '#N/A' }, 'after'],
          ],
        },
      ]),
    );
    expect(values(wb.sheets[0]!.rows)).toEqual([
      ['typed in place', 'Hello'], // the phonetic guide inside the rich string is ignored
      [42, 'text'],
      [null, 'after'],
    ]);
  });

  it('never evaluates a formula: text that looks like one stays text', () => {
    const danger = '=HYPERLINK("http://evil.example","click")';
    const wb = readWorkbook(writeXlsx([{ name: 'S', rows: [[danger, '+1+1', '@SUM(A1)', '-2']] }]));
    expect(values(wb.sheets[0]!.rows)[0]).toEqual([danger, '+1+1', '@SUM(A1)', '-2']);
  });

  it('decodes entities and CDATA, skips comments and declarations', () => {
    const parts = {
      'xl/workbook.xml':
        '<?xml version="1.0"?><!DOCTYPE x><workbook><sheets><sheet name="A &amp; B" sheetId="1" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels':
        '<Relationships><Relationship Id="rId1" Target="/xl/worksheets/sheet1.xml"/></Relationships>',
      'xl/sharedStrings.xml':
        '<sst><si><t>&#65;&#x42; &lt;ok&gt; &unknown; &amp</t></si><si><t><![CDATA[x<y & z]]></t></si><si/></sst>',
      'xl/worksheets/sheet1.xml':
        '<worksheet><!-- note --><sheetData><row r="2"><c r="B2" t="s"><v>0</v></c><c r="C2" t="s"><v>1</v></c><c r="D2" t="d"><v>2026-01-31</v></c><c r="E2" t="s"><v>2</v></c><c r="F2"><v>not a number</v></c></row></sheetData></worksheet>',
    };
    const wb = readWorkbook(zip(parts));
    expect(wb.sheets[0]!.name).toBe('A & B');
    expect(values(wb.sheets[0]!.rows)).toEqual([
      [],
      [null, 'AB <ok> &unknown; &amp', 'x<y & z', '2026-01-31'],
    ]);
  });

  it('enforces every limit', () => {
    const big = writeXlsx([
      { name: 'S', rows: Array.from({ length: 30 }, (_, r) => [r, 'x'.repeat(50), r * 2]) },
    ]);
    expect(code(() => readWorkbook(big, limits({ maxRows: 10 })))).toBe('FILE_TOO_LARGE');
    expect(code(() => readWorkbook(big, limits({ maxCols: 2 })))).toBe('FILE_TOO_LARGE');
    expect(code(() => readWorkbook(big, limits({ maxCells: 20 })))).toBe('FILE_TOO_LARGE');
    const two = writeXlsx([
      { name: 'A', rows: [['a']] },
      { name: 'B', rows: [['b']] },
    ]);
    expect(code(() => readWorkbook(two, limits({ maxSheets: 1 })))).toBe('FILE_TOO_LARGE');
    // long text is cut, not rejected
    const cut = readWorkbook(big, limits({ maxStringChars: 5 }));
    expect(cut.sheets[0]!.rows[0]![1]).toEqual({ t: 's', v: 'xxxxx' });
  });

  it('stops a zip bomb at the decompression budget', () => {
    // 2 MB of repeated cells compresses to a few kilobytes
    const bomb = writeXlsx([
      { name: 'S', rows: Array.from({ length: 4000 }, () => Array.from({ length: 20 }, () => 7)) },
    ]);
    expect(bomb.length).toBeLessThan(200_000);
    expect(code(() => readWorkbook(bomb, limits({ maxUncompressedBytes: 100_000 })))).toBe(
      'FILE_TOO_LARGE',
    );
    // the same budget is shared by stored (uncompressed) parts
    const stored = writeXlsx([{ name: 'S', rows: [['x'.repeat(5000)]] }], { store: true });
    expect(code(() => readWorkbook(stored, limits({ maxUncompressedBytes: 2000 })))).toBe(
      'FILE_TOO_LARGE',
    );
  });

  it('reports damaged, incomplete and protected files without crashing', () => {
    const good = writeXlsx([{ name: 'S', rows: [['a', 1]] }]);
    expect(code(() => readWorkbook(good.slice(0, 40)))).toBe('CORRUPT_FILE'); // cut short
    expect(code(() => readWorkbook(writeXlsx([], {})))).toBe('CORRUPT_FILE'); // no sheets
    expect(
      code(() => readWorkbook(writeXlsx([{ name: 'S', rows: [] }], { omit: ['xl/workbook.xml'] }))),
    ).toBe('CORRUPT_FILE'); // a zip, but not a workbook (for example a .docx)
    expect(
      code(() => readWorkbook(writeXlsx([{ name: 'S', rows: [] }], { encryptedFlag: true }))),
    ).toBe('ENCRYPTED_FILE');
    // a sheet named in the workbook but missing from the archive reads as empty
    const missing = readWorkbook(
      writeXlsx([{ name: 'S', rows: [['a']] }], { omit: ['xl/worksheets/sheet1.xml'] }),
    );
    expect(missing.sheets[0]!.rows).toEqual([]);

    const eocd = good.length - 22;
    // more parts than the directory can hold: the zip64 marker
    expect(code(() => readWorkbook(patched(good, (b) => b.writeUInt16LE(0xffff, eocd + 10))))).toBe(
      'UNSUPPORTED_FILE',
    );
    // directory offset pointing outside the file
    expect(
      code(() => readWorkbook(patched(good, (b) => b.writeUInt32LE(0x00ffffff, eocd + 16)))),
    ).toBe('CORRUPT_FILE');
    // an absurd number of parts
    expect(code(() => readWorkbook(patched(good, (b) => b.writeUInt16LE(5000, eocd + 10))))).toBe(
      'CORRUPT_FILE',
    );
  });

  it('rejects unknown compression and garbage compressed data', () => {
    const good = writeXlsx([{ name: 'S', rows: [['a', 1]] }]);
    const directory = Buffer.from(good).indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    // every central-directory entry: set the method to 99
    const odd = patched(good, (b) => {
      for (let p = directory; p + 46 <= b.length && b.readUInt32LE(p) === 0x02014b50;) {
        b.writeUInt16LE(99, p + 10);
        p += 46 + b.readUInt16LE(p + 28) + b.readUInt16LE(p + 30) + b.readUInt16LE(p + 32);
      }
    });
    expect(code(() => readWorkbook(odd))).toBe('CORRUPT_FILE');
    // scribble over the first part's compressed bytes
    const first =
      Buffer.from(good).indexOf(Buffer.from('xl/workbook.xml')) + 'xl/workbook.xml'.length;
    const garbage = patched(good, (b) => b.fill(0xff, first, first + 20));
    expect(code(() => readWorkbook(garbage))).toBe('CORRUPT_FILE');
  });
});

describe('.xls reader', () => {
  const rows = [['Name', 12.5, null, 'x'], [], ['Ünï ₹', NOISY]];

  it.each([
    ['in the mini stream (small file)', {}],
    ['in regular sectors', { noMiniStream: true }],
    ['with 16-bit text', { wideStrings: true }],
    ['with rich text', { richStrings: true }],
    ['in a stream called "Book"', { streamName: 'Book' }],
  ])('reads text, numbers and gaps %s', (_label, options) => {
    const wb = readWorkbook(writeXls([{ name: 'HOLDINGS', rows }], options));
    expect(wb.format).toBe('xls');
    expect(wb.sheets[0]!.name).toBe('HOLDINGS');
    expect(values(wb.sheets[0]!.rows)).toEqual([
      ['Name', 12.5, null, 'x'],
      [],
      ['Ünï ₹', 0.30000000000000004],
    ]);
  });

  it('reads a workbook larger than the mini-stream cutoff, with many sheets', () => {
    const many = Array.from({ length: 300 }, (_, r) => [`row ${r}`, r + 0.25, `text ${r}`]);
    const bytes = writeXls([
      { name: 'Big', rows: many },
      { name: 'Hidden', rows: [['h']], hidden: true },
    ]);
    expect(bytes.length).toBeGreaterThan(8192);
    const wb = readWorkbook(bytes);
    expect(wb.sheets.map((s) => [s.name, s.hidden, s.rows.length])).toEqual([
      ['Big', false, 300],
      ['Hidden', true, 1],
    ]);
    expect(values(wb.sheets[0]!.rows)[299]).toEqual(['row 299', 299.25, 'text 299']);
  });

  it('reads every kind of cell record', () => {
    const wb = readWorkbook(
      writeXls([
        {
          name: 'S',
          rows: [
            [{ label: 'in the record' }, { rk: -7 }, { rk100: 12.34 }],
            [{ mulrk: [1, 2, 3] }],
            [{ formula: 42.5 }, { formula: 'result text' }, { formula: true }, { bool: false }],
          ],
        },
      ]),
    );
    expect(values(wb.sheets[0]!.rows)).toEqual([
      ['in the record', -7, 12.34],
      [1, 2, 3],
      [42.5, 'result text', true, false],
    ]);
  });

  it('reads a string table that continues across records', () => {
    const texts = [
      'A plain sentence that is certainly longer than one small record.',
      'Ünïcödé ₹ text that must switch to sixteen-bit characters part way.',
      'short',
      'Another long line, so that a split lands inside its characters too.',
    ];
    for (const splitStringsAt of [20, 33, 64]) {
      const wb = readWorkbook(
        writeXls([{ name: 'S', rows: texts.map((t) => [t]) }], { splitStringsAt }),
      );
      expect(values(wb.sheets[0]!.rows).flat(), `split at ${splitStringsAt}`).toEqual(texts);
    }
    // rich strings carry extra bytes after the characters, across records as well
    const rich = readWorkbook(
      writeXls([{ name: 'S', rows: texts.map((t) => [t]) }], {
        splitStringsAt: 40,
        richStrings: true,
      }),
    );
    expect(values(rich.sheets[0]!.rows).flat()).toEqual(texts);
  });

  it('enforces limits and cuts long text', () => {
    const big = writeXls([
      { name: 'S', rows: Array.from({ length: 30 }, (_, r) => [r + 0.5, 'y'.repeat(40)]) },
    ]);
    expect(code(() => readWorkbook(big, limits({ maxRows: 10 })))).toBe('FILE_TOO_LARGE');
    expect(code(() => readWorkbook(big, limits({ maxCells: 20 })))).toBe('FILE_TOO_LARGE');
    expect(code(() => readWorkbook(big, limits({ maxUncompressedBytes: 100 })))).toBe(
      'FILE_TOO_LARGE',
    );
    const two = writeXls([
      { name: 'A', rows: [['a']] },
      { name: 'B', rows: [['b']] },
    ]);
    expect(code(() => readWorkbook(two, limits({ maxSheets: 1 })))).toBe('FILE_TOO_LARGE');
    const cut = readWorkbook(big, limits({ maxStringChars: 3 }));
    expect(cut.sheets[0]!.rows[0]![1]).toEqual({ t: 's', v: 'yyy' });
  });

  it('reports protected, very old and damaged files without crashing', () => {
    const sheets = [{ name: 'S', rows: [['a', 1.5]] }];
    expect(code(() => readWorkbook(writeXls(sheets, { encrypted: true })))).toBe('ENCRYPTED_FILE');
    expect(code(() => readWorkbook(writeXls(sheets, { streamName: 'EncryptedPackage' })))).toBe(
      'ENCRYPTED_FILE',
    );
    expect(code(() => readWorkbook(writeXls(sheets, { version: 0x0500 })))).toBe(
      'UNSUPPORTED_FILE',
    );
    expect(code(() => readWorkbook(writeXls(sheets, { streamName: 'SomethingElse' })))).toBe(
      'CORRUPT_FILE',
    );
    expect(code(() => readWorkbook(writeXls([])))).toBe('CORRUPT_FILE'); // no sheets
    expect(code(() => readWorkbook(compoundFile(Buffer.alloc(0))))).toBe('CORRUPT_FILE'); // empty stream

    const good = writeXls(sheets, { noMiniStream: true });
    expect(code(() => readWorkbook(good.slice(0, 300)))).toBe('CORRUPT_FILE'); // header only
    expect(code(() => readWorkbook(good.slice(0, 700)))).toBe('CORRUPT_FILE'); // sectors missing
    expect(code(() => readWorkbook(patched(good, (b) => b.writeUInt16LE(7, 30))))).toBe(
      'CORRUPT_FILE',
    ); // impossible sector size
    expect(code(() => readWorkbook(patched(good, (b) => b.writeUInt32LE(3, 68))))).toBe(
      'UNSUPPORTED_FILE',
    ); // needs a second-level allocation table: a file far above the upload limit
    // directory start pointing past the end of the file
    expect(code(() => readWorkbook(patched(good, (b) => b.writeUInt32LE(9999, 48))))).toBe(
      'CORRUPT_FILE',
    );
  });

  it('survives a looping sector chain and a broken string table', () => {
    const big = writeXls(
      [{ name: 'S', rows: Array.from({ length: 200 }, (_, r) => [`text ${r}`, r + 0.5]) }],
      { noMiniStream: true },
    );
    // make the first data sector point at itself: an endless chain
    const fatSector = Buffer.from(big).readUInt32LE(76);
    const looped = patched(big, (b) => b.writeUInt32LE(0, 512 + fatSector * 512));
    expect(code(() => readWorkbook(looped))).toBe('CORRUPT_FILE');

    const stream = biffWorkbook([{ name: 'S', rows: [['one'], ['two']] }]);
    const sst = stream.indexOf(Buffer.from([0xfc, 0x00]));
    // claim more unique strings than the table holds
    const short = Buffer.from(stream);
    short.writeUInt32LE(9, sst + 8);
    expect(code(() => readWorkbook(compoundFile(short)))).toBe('CORRUPT_FILE');
    // claim an absurd number of strings
    const absurd = Buffer.from(stream);
    absurd.writeUInt32LE(0x7fffffff, sst + 8);
    expect(code(() => readWorkbook(compoundFile(absurd)))).toBe('FILE_TOO_LARGE');
    // a workbook stream that does not start with a header record
    expect(code(() => readWorkbook(compoundFile(Buffer.alloc(64, 1))))).toBe('CORRUPT_FILE');
  });

  it('a truncated last record is ignored, keeping what is complete', () => {
    const stream = biffWorkbook([{ name: 'S', rows: [['kept', 1.5]] }]);
    const cut = stream.subarray(0, stream.length - 2); // chop the final end-of-sheet record
    expect(values(readWorkbook(compoundFile(Buffer.from(cut))).sheets[0]!.rows)).toEqual([
      ['kept', 1.5],
    ]);
  });
});

describe('XML scanner', () => {
  it('decodes the predefined and numeric entities only', () => {
    expect(decodeEntities('plain')).toBe('plain');
    expect(decodeEntities('&lt;a&gt; &amp; &quot;b&quot; &apos;c&apos;')).toBe('<a> & "b" \'c\'');
    expect(decodeEntities('&#8377;&#x20B9;')).toBe('₹₹');
    // unknown, unterminated and out-of-range references stay as written
    expect(decodeEntities('&custom; &#xZZ; &#99999999; a & b &')).toBe(
      '&custom; &#xZZ; &#99999999; a & b &',
    );
  });

  it('reports tags, attributes and text, and tolerates a truncated document', () => {
    const seen: string[] = [];
    scanXml(`<a x="1" r:id='two' bad=nope>text<b/>more</a><c attr="open`, {
      open: (name, attr, selfClosing) =>
        seen.push(
          `open ${name} x=${attr('x')} id=${attr('r:id')} bad=${attr('bad')} ${selfClosing}`,
        ),
      close: (name) => seen.push(`close ${name}`),
      text: (t) => seen.push(`text ${t}`),
    });
    expect(seen).toEqual([
      'open a x=1 id=two bad=undefined false',
      'text text',
      'open b x=undefined id=undefined bad=undefined true',
      'close b',
      'text more',
      'close a',
    ]);
    // unterminated comment and CDATA end the scan quietly
    const texts: string[] = [];
    scanXml('a<!-- never closed', { text: (t) => texts.push(t) });
    scanXml('b<![CDATA[never closed', { text: (t) => texts.push(t) });
    expect(texts).toEqual(['a', 'b', 'never closed']);
  });

  it('stays fast on hostile input (linear time)', () => {
    const started = performance.now();
    decodeEntities('&'.repeat(200_000));
    scanXml('<'.repeat(200_000), {});
    scanXml(`<a ${'x '.repeat(100_000)}>`, { open: (_n, attr) => void attr('y') });
    expect(performance.now() - started).toBeLessThan(1500);
  });
});

describe('sheet helpers', () => {
  const sheet = readWorkbook(
    writeXlsx([
      {
        name: 'S',
        rows: [
          ['Account Details'],
          ['Holdings as on', '2026-10-31'],
          ['Empty label'],
          ['  ', null],
          ['Avg. Price ($)', 'Stock Symbol', 'Extra', 'Quantity'],
          ['AAA', 1],
        ],
      },
    ]),
  ).sheets[0]!;

  it('labelKey keeps letters and digits only', () => {
    expect(labelKey('Avg. Price ($)')).toBe('avgprice');
    expect(labelKey('Unrealised P&L')).toBe('unrealisedpl');
    expect(labelKey('  Stock   Name 2 ')).toBe('stockname2');
    expect(labelKey('x'.repeat(500))).toHaveLength(80);
  });

  it('finds the header row by content, wherever the columns are', () => {
    const full = findHeaderRow(sheet, ['stocksymbol', 'quantity'], ['avgprice']);
    expect(full).toEqual({
      row: 4,
      found: 2,
      columns: { avgprice: 0, stocksymbol: 1, quantity: 3 },
    });
    const partial = findHeaderRow(sheet, ['stocksymbol', 'holdingsince']);
    expect(partial).toMatchObject({ row: 4, found: 1 });
    expect(findHeaderRow(sheet, ['nothing', 'here'])).toBeNull();
  });

  it('reads the value beside a label; blank rows and non-text cells are recognised', () => {
    expect(valueBeside(sheet, 'holdingsason')).toEqual({ t: 's', v: '2026-10-31' });
    expect(valueBeside(sheet, 'emptylabel')).toBeNull();
    expect(valueBeside(sheet, 'missing')).toBeNull();
    expect(isBlankRow(sheet.rows[3])).toBe(true);
    expect(isBlankRow(sheet.rows[4])).toBe(false);
    expect(isBlankRow(undefined)).toBe(true);
    expect(cellText({ t: 'n', v: 5 })).toBe('');
    expect(cellText(null)).toBe('');
    expect(cellText({ t: 's', v: '  padded ' })).toBe('padded');
  });
});
