// Test tooling: builds a minimal legacy .xls (BIFF8 workbook inside an OLE2 compound file) from
// invented data. Self-contained (node: imports only). Not used by the app.

export type BCell =
  | string
  | number
  | null
  | { label: string } // text stored in the cell record instead of the shared table
  | { rk: number } // integer stored in the compact RK form
  | { rk100: number } // RK form holding value × 100 (two decimal places)
  | { mulrk: number[] } // several RK integers in one record, starting at this column
  | { formula: number | string | boolean } // formula with its stored result
  | { bool: boolean };

export interface BSheet {
  name: string;
  rows: BCell[][];
  hidden?: boolean;
}

export interface XlsOptions {
  /** Start a CONTINUE record after this many bytes of string-table data (splits a string). */
  splitStringsAt?: number;
  /** Store text as 16-bit characters even when 8-bit would do. */
  wideStrings?: boolean;
  /** Add a FILEPASS record, as a password-protected workbook has. */
  encrypted?: boolean;
  /** BIFF version in the header (0x0600 = BIFF8). */
  version?: number;
  /** Name of the workbook stream ("Workbook"; BIFF5 files used "Book"). */
  streamName?: string;
  /** Force regular sectors even for a small workbook (otherwise small ones use the mini stream). */
  noMiniStream?: boolean;
  /** Add formatting-run and extension data to shared strings, as rich text has. */
  richStrings?: boolean;
}

const rec = (id: number, data: Buffer): Buffer => {
  const head = Buffer.alloc(4);
  head.writeUInt16LE(id, 0);
  head.writeUInt16LE(data.length, 2);
  return Buffer.concat([head, data]);
};

const isWide = (s: string) => [...s].some((ch) => ch.charCodeAt(0) > 255);

/** flags byte + characters, as used inside records (not the shared table). */
function inlineChars(s: string, wide: boolean): Buffer {
  return Buffer.concat([Buffer.from([wide ? 1 : 0]), Buffer.from(s, wide ? 'utf16le' : 'latin1')]);
}

const cellHead = (row: number, col: number): Buffer => {
  const b = Buffer.alloc(6);
  b.writeUInt16LE(row, 0);
  b.writeUInt16LE(col, 2);
  b.writeUInt16LE(0, 4); // format index
  return b;
};

const rkInt = (n: number, times100 = false): Buffer => {
  const b = Buffer.alloc(4);
  b.writeInt32LE((Math.round(times100 ? n * 100 : n) << 2) | 2 | (times100 ? 1 : 0), 0);
  return b;
};

/** The shared string table, split into SST + CONTINUE records. */
function stringTable(strings: string[], o: XlsOptions): Buffer[] {
  const limit = o.splitStringsAt ?? 8224;
  const records: Buffer[] = [];
  let current: Buffer[] = [];
  let size = 0;
  let id = 0x00fc;
  const flush = () => {
    records.push(rec(id, Buffer.concat(current)));
    current = [];
    size = 0;
    id = 0x003c;
  };
  const push = (b: Buffer) => {
    current.push(b);
    size += b.length;
  };
  const head = Buffer.alloc(8);
  head.writeUInt32LE(strings.length, 0);
  head.writeUInt32LE(strings.length, 4);
  push(head);

  for (const s of strings) {
    const wide = o.wideStrings || isWide(s);
    const rich = Boolean(o.richStrings);
    const header = Buffer.alloc(3 + (rich ? 6 : 0));
    header.writeUInt16LE(s.length, 0);
    header[2] = (wide ? 1 : 0) | (rich ? 0x08 | 0x04 : 0);
    if (rich) {
      header.writeUInt16LE(1, 3); // one formatting run
      header.writeUInt32LE(3, 5); // three bytes of extension data
    }
    if (size + header.length > limit) flush(); // a string header is never split
    push(header);
    const width = wide ? 2 : 1;
    let at = 0;
    while (at < s.length) {
      let room = Math.floor((limit - size) / width);
      if (room <= 0) {
        flush();
        push(Buffer.from([wide ? 1 : 0])); // continued characters restate their width
        room = Math.max(1, Math.floor((limit - size) / width));
      }
      const take = Math.min(room, s.length - at);
      push(Buffer.from(s.slice(at, at + take), wide ? 'utf16le' : 'latin1'));
      at += take;
    }
    if (rich) push(Buffer.alloc(4 + 3)); // run (4 bytes) + extension data (3 bytes)
  }
  flush();
  return records;
}

/** The BIFF8 workbook stream. */
export function biffWorkbook(sheets: BSheet[], o: XlsOptions = {}): Buffer {
  const strings: string[] = [];
  const index = new Map<string, number>();
  const share = (s: string) => {
    let i = index.get(s);
    if (i === undefined) {
      i = strings.push(s) - 1;
      index.set(s, i);
    }
    return i;
  };

  const bof = (type: number) => {
    const b = Buffer.alloc(16);
    b.writeUInt16LE(o.version ?? 0x0600, 0);
    b.writeUInt16LE(type, 2);
    b.writeUInt16LE(0x0dbb, 4);
    b.writeUInt16LE(0x07cc, 6);
    return rec(0x0809, b);
  };

  const sheetStreams = sheets.map((sheet) => {
    const parts: Buffer[] = [bof(0x0010)];
    const dim = Buffer.alloc(14);
    dim.writeUInt32LE(0, 0);
    dim.writeUInt32LE(sheet.rows.length, 4);
    dim.writeUInt16LE(0, 8);
    dim.writeUInt16LE(Math.max(0, ...sheet.rows.map((r) => r.length)), 10);
    parts.push(rec(0x0200, dim));
    sheet.rows.forEach((row, r) => {
      row.forEach((cell, c) => {
        if (cell === null) return;
        const head = cellHead(r, c);
        if (typeof cell === 'string') {
          const i = Buffer.alloc(4);
          i.writeUInt32LE(share(cell), 0);
          parts.push(rec(0x00fd, Buffer.concat([head, i])));
        } else if (typeof cell === 'number') {
          const n = Buffer.alloc(8);
          n.writeDoubleLE(cell, 0);
          parts.push(rec(0x0203, Buffer.concat([head, n])));
        } else if ('label' in cell) {
          const len = Buffer.alloc(2);
          len.writeUInt16LE(cell.label.length, 0);
          parts.push(
            rec(0x0204, Buffer.concat([head, len, inlineChars(cell.label, isWide(cell.label))])),
          );
        } else if ('rk' in cell) {
          parts.push(rec(0x027e, Buffer.concat([head, rkInt(cell.rk)])));
        } else if ('rk100' in cell) {
          parts.push(rec(0x027e, Buffer.concat([head, rkInt(cell.rk100, true)])));
        } else if ('mulrk' in cell) {
          const first = Buffer.alloc(4);
          first.writeUInt16LE(r, 0);
          first.writeUInt16LE(c, 2);
          const body = cell.mulrk.map((n) => Buffer.concat([Buffer.alloc(2), rkInt(n)]));
          const last = Buffer.alloc(2);
          last.writeUInt16LE(c + cell.mulrk.length - 1, 0);
          parts.push(rec(0x00bd, Buffer.concat([first, ...body, last])));
        } else if ('bool' in cell) {
          parts.push(rec(0x0205, Buffer.concat([head, Buffer.from([cell.bool ? 1 : 0, 0])])));
        } else {
          const result = Buffer.alloc(8);
          const v = cell.formula;
          if (typeof v === 'number') result.writeDoubleLE(v, 0);
          else {
            result[0] = typeof v === 'string' ? 0 : 1;
            if (typeof v === 'boolean') result[2] = v ? 1 : 0;
            result.writeUInt16LE(0xffff, 6);
          }
          // options (2), reserved (4), expression length 0 — the expression is never read
          parts.push(rec(0x0006, Buffer.concat([head, result, Buffer.alloc(8)])));
          if (typeof v === 'string') {
            const len = Buffer.alloc(2);
            len.writeUInt16LE(v.length, 0);
            parts.push(rec(0x0207, Buffer.concat([len, inlineChars(v, isWide(v))])));
          }
        }
      });
    });
    parts.push(rec(0x000a, Buffer.alloc(0)));
    return Buffer.concat(parts);
  });

  const codepage = Buffer.alloc(2);
  codepage.writeUInt16LE(1200, 0);
  const head: Buffer[] = [bof(0x0005)];
  if (o.encrypted) head.push(rec(0x002f, Buffer.alloc(6)));
  head.push(rec(0x0042, codepage));
  const sst = stringTable(strings, o);
  const tail = [...sst, rec(0x000a, Buffer.alloc(0))];

  // BOUNDSHEET records hold absolute offsets of each sheet, so their own size must be known first.
  const bound = (sheet: BSheet, offset: number) => {
    const fixedPart = Buffer.alloc(6);
    fixedPart.writeUInt32LE(offset, 0);
    fixedPart[4] = sheet.hidden ? 1 : 0;
    fixedPart[5] = 0; // worksheet
    return rec(
      0x0085,
      Buffer.concat([fixedPart, Buffer.from([sheet.name.length]), inlineChars(sheet.name, false)]),
    );
  };
  const size = (bs: Buffer[]) => bs.reduce((n, b) => n + b.length, 0);
  const globalsSize = size(head) + size(sheets.map((s) => bound(s, 0))) + size(tail);
  let at = globalsSize;
  const bounds = sheets.map((s, i) => {
    const b = bound(s, at);
    at += sheetStreams[i]!.length;
    return b;
  });
  return Buffer.concat([...head, ...bounds, ...tail, ...sheetStreams]);
}

const END = 0xfffffffe;
const FREE = 0xffffffff;
const FAT_SECTOR = 0xfffffffd;

function dirEntry(name: string, type: number, start: number, size: number, child = FREE): Buffer {
  const e = Buffer.alloc(128);
  const n = Buffer.from(name, 'utf16le');
  n.copy(e, 0);
  e.writeUInt16LE(n.length + 2, 64);
  e[66] = type;
  e[67] = 1;
  e.writeUInt32LE(FREE, 68);
  e.writeUInt32LE(FREE, 72);
  e.writeUInt32LE(child, 76);
  e.writeUInt32LE(start, 116);
  e.writeUInt32LE(size, 120);
  return e;
}

const pad = (b: Buffer, multiple: number) =>
  b.length % multiple === 0
    ? b
    : Buffer.concat([b, Buffer.alloc(multiple - (b.length % multiple))]);

/** Wrap a stream in an OLE2 compound file (512-byte sectors). */
export function compoundFile(stream: Buffer, o: XlsOptions = {}): Uint8Array {
  const name = o.streamName ?? 'Workbook';
  const mini = stream.length < 4096 && !o.noMiniStream;
  const dataSectors = Math.ceil(pad(stream, mini ? 64 : 512).length / 512);
  const miniFatSectors = mini ? 1 : 0;
  // layout: [data …][mini FAT][directory][FAT …]
  let fatSectors = 1;
  while (dataSectors + miniFatSectors + 1 + fatSectors > fatSectors * 128) fatSectors++;
  const miniFatAt = dataSectors;
  const dirAt = dataSectors + miniFatSectors;
  const fatAt = dirAt + 1;

  const fat = new Array<number>(fatSectors * 128).fill(FREE);
  for (let i = 0; i < dataSectors; i++) fat[i] = i === dataSectors - 1 ? END : i + 1;
  if (mini) fat[miniFatAt] = END;
  fat[dirAt] = END;
  for (let i = 0; i < fatSectors; i++) fat[fatAt + i] = FAT_SECTOR;

  const header = Buffer.alloc(512);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(header, 0);
  header.writeUInt16LE(0x003e, 24);
  header.writeUInt16LE(0x0003, 26);
  header.writeUInt16LE(0xfffe, 28);
  header.writeUInt16LE(9, 30);
  header.writeUInt16LE(6, 32);
  header.writeUInt32LE(fatSectors, 44);
  header.writeUInt32LE(dirAt, 48);
  header.writeUInt32LE(o.noMiniStream ? 0 : 4096, 56); // cutoff 0 = no stream is "small"
  header.writeUInt32LE(mini ? miniFatAt : END, 60);
  header.writeUInt32LE(miniFatSectors, 64);
  header.writeUInt32LE(END, 68);
  for (let i = 0; i < 109; i++) header.writeUInt32LE(i < fatSectors ? fatAt + i : FREE, 76 + i * 4);

  const parts: Buffer[] = [header, pad(stream, 512)];
  if (mini) {
    const miniFat = Buffer.alloc(512, 0xff);
    const miniSectors = Math.ceil(stream.length / 64);
    for (let i = 0; i < miniSectors; i++) {
      miniFat.writeUInt32LE(i === miniSectors - 1 ? END : i + 1, i * 4);
    }
    parts.push(miniFat);
  }
  const dir = Buffer.concat([
    dirEntry('Root Entry', 5, mini ? 0 : END, mini ? pad(stream, 64).length : 0, 1),
    dirEntry(name, 2, 0, stream.length),
    Buffer.alloc(256),
  ]);
  parts.push(dir);
  const fatBytes = Buffer.alloc(fat.length * 4);
  fat.forEach((v, i) => fatBytes.writeUInt32LE(v >>> 0, i * 4));
  parts.push(fatBytes);
  return new Uint8Array(Buffer.concat(parts));
}

export const writeXls = (sheets: BSheet[], o: XlsOptions = {}): Uint8Array =>
  compoundFile(biffWorkbook(sheets, o), o);
