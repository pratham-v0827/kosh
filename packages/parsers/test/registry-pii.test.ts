import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  detectAll,
  ImportError,
  MAX_FILE_BYTES,
  MAX_IMPORT_ROWS,
  type Parser,
  type ParserInput,
  PARSERS,
  redactPii,
  runImport,
  scanPii,
  supportedFormats,
} from '../src';

const ctx = { today: '2026-11-14', maxRows: MAX_IMPORT_ROWS };
const enc = (s: string) => new TextEncoder().encode(s);
const caught = (fn: () => unknown): ImportError => {
  try {
    fn();
  } catch (e) {
    if (e instanceof ImportError) return e;
    throw e;
  }
  throw new Error('expected an ImportError');
};

describe('registry', () => {
  afterEach(() => vi.restoreAllMocks());

  it('every parser has a unique id, a semver version and at least one extension', () => {
    expect(new Set(PARSERS.map((p) => p.id)).size).toBe(PARSERS.length);
    for (const p of PARSERS) {
      expect(p.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(p.extensions.length).toBeGreaterThan(0);
    }
    expect(supportedFormats()[0]).toMatchObject({ id: 'kosh.csv', version: '1.0.0' });
  });

  it('unknown file → UNKNOWN_FORMAT listing what is supported', () => {
    const e = caught(() => runImport({ bytes: enc('hello,world\n1,2\n'), fileName: 'x.csv' }, ctx));
    expect(e.code).toBe('UNKNOWN_FORMAT');
    expect(e.details?.supported).toEqual(supportedFormats());
  });

  it('empty and oversized files are refused before any parsing', () => {
    const spy: Parser = {
      ...PARSERS[0]!,
      detect: vi.fn(() => 1),
      parse: vi.fn(),
    };
    expect(
      caught(() => runImport({ bytes: new Uint8Array(), fileName: 'a' }, ctx, [spy])).code,
    ).toBe('EMPTY_FILE');
    const big = { bytes: new Uint8Array(MAX_FILE_BYTES + 1), fileName: 'a' };
    expect(caught(() => runImport(big, ctx, [spy])).code).toBe('FILE_TOO_LARGE');
    expect(spy.detect).not.toHaveBeenCalled();
    expect(spy.parse).not.toHaveBeenCalled();
  });

  it('a parser whose detect() throws simply does not claim the file', () => {
    const broken: Parser = {
      ...PARSERS[0]!,
      id: 'broken',
      detect: () => {
        throw new Error('boom');
      },
    };
    const input = { bytes: enc('x'), fileName: 'x' };
    expect(detectAll(input, [broken])[0]?.confidence).toBe(0);
  });

  it('never leaks the password, file name or contents through an error or the console', () => {
    const logs = ['log', 'info', 'warn', 'error', 'debug'].map((m) =>
      vi.spyOn(console, m as 'log').mockImplementation(() => {}),
    );
    const input: ParserInput = {
      bytes: enc('ACCOUNT HOLDER: A. Person, secret-cell-value'),
      fileName: 'statement-of-A-Person.pdf',
      password: 'Hunter2!pdf-password',
    };
    const leaky: Parser = {
      ...PARSERS[0]!,
      id: 'cas.cams',
      label: 'CAS (CAMS)',
      detect: () => 1,
      parse: (i) => {
        // what a careless PDF library might do
        throw new Error(
          `cannot decrypt ${i.fileName} with password ${i.password}: secret-cell-value`,
        );
      },
    };
    const e = caught(() => runImport(input, ctx, [leaky]));
    expect(e.code).toBe('PARSER_FAILED');
    const visible = JSON.stringify({ message: e.message, details: e.details, stack: e.stack });
    for (const secret of ['Hunter2', 'A-Person', 'A. Person', 'secret-cell-value']) {
      expect(visible).not.toContain(secret);
    }
    for (const l of logs) expect(l).not.toHaveBeenCalled();
  });
});

describe('personal-data scan and redaction', () => {
  const statement = [
    'Name,PAN,Email,Mobile,Client ID,IFSC',
    'A Person,ABCPD1234E,a.person@gmail.com,9876543210,IN30012345678901,HDFC0001234',
    'A Person,ABCPD1234E,second@yahoo.in,+91 9876543210,1234567890123456,HDFC0001234',
    'B Person,XYZPB9876K,a.person@gmail.com,9123456780,IN30012399999999,ICIC0005678',
  ].join('\n');

  it('finds PAN, email, phone, demat and IFSC, and reports them masked', () => {
    const found = scanPii(statement);
    expect(new Set(found.map((f) => f.kind))).toEqual(
      new Set(['PAN', 'EMAIL', 'PHONE', 'DEMAT', 'IFSC']),
    );
    expect(found.every((f) => f.line >= 2)).toBe(true);
    const report = JSON.stringify(found);
    for (const raw of ['ABCPD1234E', 'a.person@gmail.com', '9876543210', 'IN30012345678901']) {
      expect(report).not.toContain(raw);
    }
  });

  it('redacts with consistent fakes that pass the scan', () => {
    const { text, replaced } = redactPii(statement);
    expect(scanPii(text)).toEqual([]);
    expect(replaced.PAN).toBe(3);
    const lines = text.split('\n').map((l) => l.split(','));
    // same real value → same fake; different real values stay different
    expect(lines[1]![2]).toBe(lines[3]![2]);
    expect(lines[1]![2]).not.toBe(lines[2]![2]);
    expect(lines[1]![4]).not.toBe(lines[3]![4]);
    expect(lines[0]!.join(',')).toBe('Name,PAN,Email,Mobile,Client ID,IFSC'); // headers untouched
  });

  it('leaves market data alone', () => {
    const market =
      'INE002A01018,RELIANCE,120590,2024-04-01,2900.50,1234567.89,0.00012345,ORD-1001,INF209K01YY8';
    expect(scanPii(market)).toEqual([]);
    expect(redactPii(market).text).toBe(market);
  });
});

describe('committed fixtures contain no personal data', () => {
  const root = resolve(import.meta.dirname, '..');
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      if (name === '_incoming' || name === 'node_modules') return []; // local-only, git-ignored
      return statSync(p).isDirectory() ? walk(p) : [p];
    });

  it('fixtures, tests and the public template pass the scan', () => {
    const files = [
      ...walk(join(root, 'fixtures')),
      resolve(root, '../../apps/web/public/templates/kosh-import-template.csv'),
    ];
    expect(files.length).toBeGreaterThan(1);
    const dirty = files
      .map((f) => ({ f: f.slice(root.length), n: scanPii(readFileSync(f, 'utf8')).length }))
      .filter((x) => x.n > 0);
    expect(dirty).toEqual([]);
  });
});
