import { inflateRawSync } from 'node:zlib';
import { ImportError } from '../errors';
import { type Cell, SheetBuilder, type SheetLimits, type Workbook } from './types';
import { scanXml } from './xml';

/**
 * Read-only reader for .xlsx (a zip of XML parts). Values only: formulas are not evaluated,
 * styles, macros, external links and embedded objects are never opened.
 */

const corrupt = (why: string): never => {
  throw new ImportError('CORRUPT_FILE', `This Excel file could not be read (${why})`);
};

interface ZipEntry {
  method: number;
  compressedSize: number;
  dataStart: number;
}

const MAX_ZIP_ENTRIES = 2000;

/** Central directory of a zip. Sizes inside are never trusted for allocation. */
function zipDirectory(buf: Buffer): Map<string, ZipEntry> {
  const EOCD = 0x06054b50;
  let eocd = -1;
  for (let i = buf.length - 22, stop = Math.max(0, buf.length - 22 - 65535); i >= stop; i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) corrupt('not a zip archive');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || p === 0xffffffff) {
    throw new ImportError('UNSUPPORTED_FILE', 'This Excel file is too large for Kosh to read');
  }
  if (count > MAX_ZIP_ENTRIES) corrupt('too many parts');

  const entries = new Map<string, ZipEntry>();
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) corrupt('damaged directory');
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (flags & 1) {
      throw new ImportError(
        'ENCRYPTED_FILE',
        'This Excel file is password-protected. Remove the password and upload it again',
      );
    }
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) corrupt('damaged entry');
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    if (dataStart + compressedSize > buf.length) corrupt('truncated entry');
    entries.set(name, { method, compressedSize, dataStart });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Column letters of a cell reference ("AB12" → 27). Returns -1 when there are none. */
function columnOf(ref: string): number {
  let col = 0;
  let i = 0;
  for (; i < ref.length && i < 4; i++) {
    const c = ref.charCodeAt(i);
    if (c < 65 || c > 90) break;
    col = col * 26 + (c - 64);
  }
  return i === 0 ? -1 : col - 1;
}

export function readXlsx(bytes: Uint8Array, limits: SheetLimits): Workbook {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = zipDirectory(buf);
  let budget = limits.maxUncompressedBytes;

  /** Inflate one part as text. The output is capped by what is left of the overall budget. */
  const part = (name: string): string | null => {
    const e = entries.get(name);
    if (!e) return null;
    const raw = buf.subarray(e.dataStart, e.dataStart + e.compressedSize);
    let out: Buffer;
    if (e.method === 0) out = raw;
    else if (e.method === 8) {
      try {
        out = inflateRawSync(raw, { maxOutputLength: Math.max(1, budget) });
      } catch (err) {
        if ((err as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE') {
          throw new ImportError('FILE_TOO_LARGE', 'This file expands to too much data to import');
        }
        return corrupt('damaged compression');
      }
    } else return corrupt('unsupported compression');
    budget -= out.length;
    if (budget < 0) {
      throw new ImportError('FILE_TOO_LARGE', 'This file expands to too much data to import');
    }
    return out.toString('utf8');
  };

  const workbookXml = part('xl/workbook.xml');
  if (workbookXml === null) corrupt('no workbook inside');

  // sheet list, in workbook order
  const sheetRefs: { name: string; rid: string; hidden: boolean }[] = [];
  scanXml(workbookXml!, {
    open(name, attr) {
      if (name !== 'sheet') return;
      const state = attr('state');
      sheetRefs.push({
        name: attr('name') ?? '',
        rid: attr('r:id') ?? attr('id') ?? '',
        hidden: state === 'hidden' || state === 'veryHidden',
      });
    },
  });
  if (sheetRefs.length === 0) corrupt('no sheets');
  if (sheetRefs.length > limits.maxSheets) {
    throw new ImportError('FILE_TOO_LARGE', 'This file has too many sheets to import');
  }

  const targets = new Map<string, string>();
  scanXml(part('xl/_rels/workbook.xml.rels') ?? '', {
    open(name, attr) {
      if (name !== 'Relationship') return;
      const id = attr('Id');
      const target = attr('Target');
      if (!id || !target) return;
      targets.set(id, target.startsWith('/') ? target.slice(1) : `xl/${target}`);
    },
  });

  // shared strings: text of <t> inside each <si>, ignoring phonetic runs (<rPh>)
  const shared: string[] = [];
  {
    let inSi = false;
    let inT = false;
    let phonetic = 0;
    let current = '';
    scanXml(part('xl/sharedStrings.xml') ?? '', {
      open(name, _attr, selfClosing) {
        if (name === 'si') {
          inSi = true;
          current = '';
        } else if (name === 'rPh' && !selfClosing) phonetic++;
        else if (name === 't' && inSi && phonetic === 0 && !selfClosing) inT = true;
      },
      close(name) {
        if (name === 'si' && inSi) {
          shared.push(current.slice(0, limits.maxStringChars));
          inSi = false;
        } else if (name === 'rPh' && phonetic > 0) phonetic--;
        else if (name === 't') inT = false;
      },
      text(t) {
        if (inT && current.length < limits.maxStringChars) current += t;
      },
    });
  }

  const cellBudget = { cells: 0 };
  const tooBig = (message: string): never => {
    throw new ImportError('FILE_TOO_LARGE', message);
  };
  const sheets = sheetRefs.map((ref) => {
    const builder = new SheetBuilder(ref.name, ref.hidden, limits, cellBudget, tooBig);
    const xml = part(targets.get(ref.rid) ?? '');
    if (xml === null) return builder.build();

    let row = -1;
    let col = -1;
    let type = 'n';
    let inCell = false;
    let capture: 'v' | 't' | null = null;
    let value = '';
    let inline = '';
    scanXml(xml, {
      open(name, attr, selfClosing) {
        if (name === 'row') {
          const r = Number(attr('r'));
          row = Number.isInteger(r) && r > 0 ? r - 1 : row + 1;
          col = -1;
        } else if (name === 'c') {
          const ref = attr('r');
          const c = ref ? columnOf(ref) : -1;
          col = c >= 0 ? c : col + 1;
          type = attr('t') ?? 'n';
          inCell = !selfClosing;
          value = '';
          inline = '';
        } else if (inCell && name === 'v' && !selfClosing) capture = 'v';
        else if (inCell && name === 't' && !selfClosing) capture = 't';
      },
      close(name) {
        if (name === 'v' || name === 't') capture = null;
        if (name !== 'c' || !inCell) return;
        inCell = false;
        let cell: Cell = null;
        if (type === 's') {
          const s = shared[Number(value)];
          if (s !== undefined && s !== '') cell = { t: 's', v: s };
        } else if (type === 'inlineStr') {
          if (inline !== '') cell = { t: 's', v: inline };
        } else if (type === 'str' || type === 'd') {
          if (value !== '') cell = { t: 's', v: value };
        } else if (type === 'b') {
          cell = { t: 'b', v: value === '1' };
        } else if (type === 'n' && value !== '') {
          const n = Number(value);
          if (Number.isFinite(n)) cell = { t: 'n', v: n };
        } // type "e" (an Excel error such as #N/A) is treated as an empty cell
        if (cell) builder.set(row, col, cell);
      },
      text(t) {
        if (capture === 'v' && value.length < limits.maxStringChars) value += t;
        else if (capture === 't' && inline.length < limits.maxStringChars) inline += t;
      },
    });
    return builder.build();
  });

  return { format: 'xlsx', sheets };
}
