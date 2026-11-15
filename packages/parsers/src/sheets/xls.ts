import { ImportError } from '../errors';
import { SheetBuilder, type SheetLimits, type Workbook } from './types';

/**
 * Read-only reader for legacy .xls files: an OLE2 compound file holding a BIFF8 "Workbook"
 * stream. Values only: formulas are not evaluated (their stored result is used), and macros,
 * embedded objects and every other stream are never opened. All offsets are bounds-checked and
 * every chain has a step limit, so a damaged or hostile file ends in an ImportError.
 */

const corrupt = (why: string): never => {
  throw new ImportError('CORRUPT_FILE', `This Excel file could not be read (${why})`);
};

const FREE = 0xfffffffe; // sector ids at or above this are end-of-chain / free markers

/** Extract the Workbook stream from the compound file. */
function workbookStream(buf: Buffer, limits: SheetLimits): Buffer {
  if (buf.length < 512) corrupt('too short');
  const sectorSize = 1 << buf.readUInt16LE(30);
  const miniSize = 1 << buf.readUInt16LE(32);
  if ((sectorSize !== 512 && sectorSize !== 4096) || miniSize !== 64) corrupt('odd sector size');
  const fatSectors = buf.readUInt32LE(44);
  const dirStart = buf.readUInt32LE(48);
  const miniCutoff = buf.readUInt32LE(56);
  const miniFatStart = buf.readUInt32LE(60);
  const sectorCount = Math.floor((buf.length - 512) / sectorSize);
  if (buf.readUInt32LE(68) < FREE || fatSectors > 109) {
    // more than 109 FAT sectors means a file of several megabytes: beyond the upload limit
    throw new ImportError('UNSUPPORTED_FILE', 'This Excel file is too large for Kosh to read');
  }
  const sector = (n: number): Buffer => {
    if (n >= sectorCount) corrupt('sector out of range');
    return buf.subarray(512 + n * sectorSize, 512 + (n + 1) * sectorSize);
  };

  const fat: number[] = [];
  for (let i = 0; i < fatSectors; i++) {
    const s = sector(buf.readUInt32LE(76 + i * 4));
    for (let o = 0; o < sectorSize; o += 4) fat.push(s.readUInt32LE(o));
  }
  /** Follow a chain in `table`, stopping at an end marker. A loop or overrun is an error. */
  const chain = (start: number, table: number[], maxSteps: number): number[] => {
    const out: number[] = [];
    for (let s = start; s < FREE; s = table[s] ?? FREE) {
      if (out.length >= maxSteps) corrupt('endless chain');
      out.push(s);
    }
    return out;
  };
  const readChain = (start: number): Buffer =>
    Buffer.concat(chain(start, fat, sectorCount).map(sector));

  const dir = readChain(dirStart);
  let root: { start: number; size: number } | null = null;
  let book: { start: number; size: number } | null = null;
  for (let o = 0; o + 128 <= dir.length; o += 128) {
    const nameBytes = dir.readUInt16LE(o + 64);
    if (nameBytes < 2 || nameBytes > 64) continue;
    const name = dir.toString('utf16le', o, o + nameBytes - 2);
    const entry = { start: dir.readUInt32LE(o + 116), size: dir.readUInt32LE(o + 120) };
    const type = dir[o + 66];
    if (type === 5) root = entry;
    else if (type === 2 && (name === 'Workbook' || name === 'Book')) book = entry;
    else if (type === 2 && name === 'EncryptedPackage') {
      throw new ImportError(
        'ENCRYPTED_FILE',
        'This Excel file is password-protected. Remove the password and upload it again',
      );
    }
  }
  if (!book) return corrupt('no workbook inside');
  if (book.size > limits.maxUncompressedBytes) {
    throw new ImportError('FILE_TOO_LARGE', 'This file holds too much data to import');
  }

  if (book.size >= miniCutoff) {
    const data = readChain(book.start);
    if (data.length < book.size) corrupt('truncated workbook');
    return data.subarray(0, book.size);
  }
  // Small streams live in the "mini stream", itself stored in the root entry's chain.
  if (!root) return corrupt('no root entry');
  const mini = readChain(root.start);
  const miniFat: number[] = [];
  if (miniFatStart < FREE) {
    const mf = readChain(miniFatStart);
    for (let o = 0; o + 4 <= mf.length; o += 4) miniFat.push(mf.readUInt32LE(o));
  }
  const parts = chain(book.start, miniFat, miniFat.length + 1).map((s) => {
    if ((s + 1) * miniSize > mini.length) corrupt('mini sector out of range');
    return mini.subarray(s * miniSize, (s + 1) * miniSize);
  });
  const data = Buffer.concat(parts);
  if (data.length < book.size) corrupt('truncated workbook');
  return data.subarray(0, book.size);
}

interface BiffRecord {
  id: number;
  data: Buffer;
  /** Offset of the record header in the stream (sheets are addressed by this). */
  pos: number;
}

function records(stream: Buffer): BiffRecord[] {
  const out: BiffRecord[] = [];
  for (let p = 0; p + 4 <= stream.length;) {
    const id = stream.readUInt16LE(p);
    const len = stream.readUInt16LE(p + 2);
    if (p + 4 + len > stream.length) break; // truncated tail: keep what is complete
    out.push({ id, data: stream.subarray(p + 4, p + 4 + len), pos: p });
    p += 4 + len;
  }
  return out;
}

/**
 * Reads the shared string table, whose strings may continue across CONTINUE records. When a
 * string's characters cross a record boundary, the next record starts with a fresh flags byte
 * that may switch between 8-bit and 16-bit characters.
 */
class StringTableReader {
  private chunk = 0;
  private off = 0;

  constructor(
    private readonly chunks: Buffer[],
    private readonly maxChars: number,
  ) {}

  private get cur(): Buffer {
    return this.chunks[this.chunk] ?? Buffer.alloc(0);
  }

  private get done(): boolean {
    return this.chunk >= this.chunks.length;
  }

  /** Move to the next chunk when the current one is used up. */
  private settle(): void {
    while (!this.done && this.off >= this.cur.length) {
      this.chunk++;
      this.off = 0;
    }
  }

  private u8(): number {
    this.settle();
    if (this.done) corrupt('string table ends early');
    return this.cur[this.off++]!;
  }

  private u16(): number {
    this.settle();
    if (this.done || this.off + 2 > this.cur.length) corrupt('string table ends early');
    const v = this.cur.readUInt16LE(this.off);
    this.off += 2;
    return v;
  }

  private u32(): number {
    this.settle();
    if (this.done || this.off + 4 > this.cur.length) corrupt('string table ends early');
    const v = this.cur.readUInt32LE(this.off);
    this.off += 4;
    return v;
  }

  /** Skip bytes that carry no flags byte when they cross a boundary (formatting runs). */
  private skip(n: number): void {
    while (n > 0) {
      this.settle();
      if (this.done) corrupt('string table ends early');
      const take = Math.min(n, this.cur.length - this.off);
      this.off += take;
      n -= take;
    }
  }

  skipHeader(): void {
    this.skip(8); // total and unique string counts
  }

  next(): string {
    const chars = this.u16();
    const flags = this.u8();
    const runs = flags & 0x08 ? this.u16() : 0;
    const ext = flags & 0x04 ? this.u32() : 0;
    let wide = (flags & 0x01) === 1;
    let left = chars;
    let out = '';
    while (left > 0) {
      if (!this.done && this.off >= this.cur.length) {
        // characters continue in the next record, which restates the character width
        this.settle();
        wide = (this.u8() & 0x01) === 1;
      }
      if (this.done) corrupt('string table ends early');
      const width = wide ? 2 : 1;
      const take = Math.min(left, Math.floor((this.cur.length - this.off) / width));
      if (take === 0) corrupt('string table is damaged');
      const end = this.off + take * width;
      if (out.length < this.maxChars) {
        out += this.cur.toString(wide ? 'utf16le' : 'latin1', this.off, end);
      }
      this.off = end;
      left -= take;
    }
    this.skip(runs * 4 + ext);
    return out.length > this.maxChars ? out.slice(0, this.maxChars) : out;
  }
}

/** A string stored inside one record: flags byte, optional run/extension sizes, characters. */
function inlineString(d: Buffer, offset: number, chars: number): string {
  if (offset >= d.length) return '';
  const flags = d[offset]!;
  let p = offset + 1;
  if (flags & 0x08) p += 2;
  if (flags & 0x04) p += 4;
  const wide = flags & 0x01;
  const end = Math.min(d.length, p + chars * (wide ? 2 : 1));
  return d.toString(wide ? 'utf16le' : 'latin1', p, end);
}

/** RK: a 30-bit integer or the top 30 bits of a double, optionally divided by 100. */
function rkNumber(rk: number): number {
  let v: number;
  if (rk & 2) v = rk >> 2;
  else {
    const b = Buffer.alloc(8);
    b.writeUInt32LE((rk & 0xfffffffc) >>> 0, 4);
    v = b.readDoubleLE(0);
  }
  return rk & 1 ? v / 100 : v;
}

const R = {
  BOF: 0x0809,
  EOF: 0x000a,
  FILEPASS: 0x002f,
  CONTINUE: 0x003c,
  BOUNDSHEET: 0x0085,
  SST: 0x00fc,
  LABELSST: 0x00fd,
  LABEL: 0x0204,
  NUMBER: 0x0203,
  RK: 0x027e,
  MULRK: 0x00bd,
  FORMULA: 0x0006,
  STRING: 0x0207,
  BOOLERR: 0x0205,
} as const;

export function readXls(bytes: Uint8Array, limits: SheetLimits): Workbook {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const recs = records(workbookStream(buf, limits));
  const first = recs[0];
  if (!first || first.id !== R.BOF || first.data.length < 4) return corrupt('no workbook header');
  if (first.data.readUInt16LE(0) !== 0x0600) {
    throw new ImportError(
      'UNSUPPORTED_FILE',
      'This is a very old Excel format. Open it in a spreadsheet app and save it as .xlsx',
    );
  }

  // ---- workbook globals: sheet list and shared strings ----
  const sheetMeta: { pos: number; name: string; hidden: boolean; worksheet: boolean }[] = [];
  let strings: string[] = [];
  for (let i = 0; i < recs.length; i++) {
    const { id, data } = recs[i]!;
    if (id === R.FILEPASS) {
      throw new ImportError(
        'ENCRYPTED_FILE',
        'This Excel file is password-protected. Remove the password and upload it again',
      );
    }
    if (id === R.BOUNDSHEET && data.length >= 8) {
      sheetMeta.push({
        pos: data.readUInt32LE(0),
        hidden: (data[4]! & 0x03) !== 0,
        worksheet: data[5] === 0,
        name: inlineString(data, 7, data[6]!),
      });
    } else if (id === R.SST && data.length >= 8) {
      const chunks = [data];
      for (let j = i + 1; recs[j]?.id === R.CONTINUE; j++) chunks.push(recs[j]!.data);
      const unique = data.readUInt32LE(4);
      if (unique > limits.maxCells) {
        throw new ImportError('FILE_TOO_LARGE', 'The file has too many cells');
      }
      const reader = new StringTableReader(chunks, limits.maxStringChars);
      reader.skipHeader();
      strings = [];
      for (let k = 0; k < unique; k++) strings.push(reader.next());
    } else if (id === R.EOF) break; // end of the globals substream
  }
  const worksheets = sheetMeta.filter((s) => s.worksheet);
  if (worksheets.length === 0) corrupt('no sheets');
  if (worksheets.length > limits.maxSheets) {
    throw new ImportError('FILE_TOO_LARGE', 'This file has too many sheets to import');
  }

  // ---- cells ----
  const cellBudget = { cells: 0 };
  const tooBig = (message: string): never => {
    throw new ImportError('FILE_TOO_LARGE', message);
  };
  const byPos = new Map(recs.map((r, i) => [r.pos, i]));
  const sheets = worksheets.map((meta) => {
    const b = new SheetBuilder(meta.name, meta.hidden, limits, cellBudget, tooBig);
    const start = byPos.get(meta.pos);
    if (start === undefined || recs[start]!.id !== R.BOF) return b.build();
    let pendingString: { row: number; col: number } | null = null;
    for (let i = start + 1; i < recs.length; i++) {
      const { id, data: d } = recs[i]!;
      if (id === R.EOF) break;
      if (id === R.LABELSST && d.length >= 10) {
        const s = strings[d.readUInt32LE(6)];
        if (s) b.set(d.readUInt16LE(0), d.readUInt16LE(2), { t: 's', v: s });
      } else if (id === R.LABEL && d.length >= 9) {
        const s = inlineString(d, 8, d.readUInt16LE(6));
        if (s) b.set(d.readUInt16LE(0), d.readUInt16LE(2), { t: 's', v: s });
      } else if (id === R.NUMBER && d.length >= 14) {
        const n = d.readDoubleLE(6);
        if (Number.isFinite(n)) b.set(d.readUInt16LE(0), d.readUInt16LE(2), { t: 'n', v: n });
      } else if (id === R.RK && d.length >= 10) {
        b.set(d.readUInt16LE(0), d.readUInt16LE(2), { t: 'n', v: rkNumber(d.readUInt32LE(6)) });
      } else if (id === R.MULRK && d.length >= 12) {
        const row = d.readUInt16LE(0);
        let col = d.readUInt16LE(2);
        for (let o = 4; o + 6 <= d.length - 2; o += 6, col++) {
          b.set(row, col, { t: 'n', v: rkNumber(d.readUInt32LE(o + 2)) });
        }
      } else if (id === R.FORMULA && d.length >= 14) {
        // Only the stored result is used; the formula itself is never read or evaluated.
        const row = d.readUInt16LE(0);
        const col = d.readUInt16LE(2);
        if (d.readUInt16LE(12) !== 0xffff) {
          const n = d.readDoubleLE(6);
          if (Number.isFinite(n)) b.set(row, col, { t: 'n', v: n });
        } else if (d[6] === 0) pendingString = { row, col };
        else if (d[6] === 1) b.set(row, col, { t: 'b', v: d[8] !== 0 });
      } else if (id === R.STRING && pendingString && d.length >= 3) {
        const s = inlineString(d, 2, d.readUInt16LE(0));
        if (s) b.set(pendingString.row, pendingString.col, { t: 's', v: s });
        pendingString = null;
      } else if (id === R.BOOLERR && d.length >= 8 && d[7] === 0) {
        b.set(d.readUInt16LE(0), d.readUInt16LE(2), { t: 'b', v: d[6] !== 0 });
      }
    }
    return b.build();
  });

  return { format: 'xls', sheets };
}
