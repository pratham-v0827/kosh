// Test tooling: builds a minimal .xlsx from invented data. Self-contained (node: imports only) so
// the fixture script can load it directly. Not used by the app.
import { crc32, deflateRawSync } from 'node:zlib';

export type XCell =
  | string
  | number
  | boolean
  | null
  | { inline: string } // inline string instead of a shared string
  | { rich: string[] } // shared string made of several formatted runs
  | { formula: string; result: number | string } // formula with its stored result
  | { error: string }; // an Excel error value such as #N/A

export interface XSheet {
  name: string;
  rows: XCell[][];
  hidden?: boolean;
}

export interface XlsxOptions {
  /** Store parts without compression. */
  store?: boolean;
  /** Omit the r="A1" references (allowed by the format; cells are then positional). */
  omitRefs?: boolean;
  /** Use a namespace prefix on sheet elements (<x:row>…), as some generators do. */
  prefix?: boolean;
  /** Extra parts to add to the archive, e.g. to imitate another kind of zip. */
  extraParts?: Record<string, string>;
  /** Leave out a part by name (to build damaged files). */
  omit?: string[];
  /** Set the "encrypted" flag on every entry. */
  encryptedFlag?: boolean;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const colName = (c: number) => {
  let s = '';
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  }
  return s;
};

/** Zip the given parts (deflate by default). */
export function zip(parts: Record<string, string | Uint8Array>, o: XlsxOptions = {}): Uint8Array {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(parts)) {
    const data = Buffer.from(content);
    const body = o.store ? data : deflateRawSync(data);
    const nameBytes = Buffer.from(name, 'utf8');
    const flags = o.encryptedFlag ? 1 : 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(o.store ? 0 : 8, 8);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    chunks.push(local, nameBytes, body);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(flags, 8);
    dir.writeUInt16LE(o.store ? 0 : 8, 10);
    dir.writeUInt32LE(crc32(data), 16);
    dir.writeUInt32LE(body.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(nameBytes.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, nameBytes);
    offset += 30 + nameBytes.length + body.length;
  }
  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(parts).length, 8);
  end.writeUInt16LE(Object.keys(parts).length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...chunks, centralBytes, end]));
}

export function writeXlsx(sheets: XSheet[], o: XlsxOptions = {}): Uint8Array {
  const shared: string[] = [];
  const sharedXml: string[] = [];
  const index = new Map<string, number>();
  const share = (key: string, xml: string) => {
    let i = index.get(key);
    if (i === undefined) {
      i = shared.push(key) - 1;
      index.set(key, i);
      sharedXml.push(xml);
    }
    return i;
  };
  const p = o.prefix ? 'x:' : '';

  const sheetXml = sheets.map((sheet) => {
    const rows = sheet.rows
      .map((row, r) => {
        const cells = row
          .map((cell, c) => {
            const ref = o.omitRefs ? '' : ` r="${colName(c)}${r + 1}"`;
            if (cell === null) return o.omitRefs ? `<${p}c/>` : '';
            if (typeof cell === 'number') return `<${p}c${ref}><${p}v>${cell}</${p}v></${p}c>`;
            if (typeof cell === 'boolean') {
              return `<${p}c${ref} t="b"><${p}v>${cell ? 1 : 0}</${p}v></${p}c>`;
            }
            if (typeof cell === 'string') {
              const i = share(`s:${cell}`, `<si><t xml:space="preserve">${esc(cell)}</t></si>`);
              return `<${p}c${ref} t="s"><${p}v>${i}</${p}v></${p}c>`;
            }
            if ('inline' in cell) {
              return `<${p}c${ref} t="inlineStr"><${p}is><${p}t>${esc(cell.inline)}</${p}t></${p}is></${p}c>`;
            }
            if ('rich' in cell) {
              const runs = cell.rich.map((t) => `<r><rPr><b/></rPr><t>${esc(t)}</t></r>`).join('');
              const i = share(
                `r:${cell.rich.join('|')}`,
                `<si>${runs}<rPh sb="0" eb="1"><t>phonetic</t></rPh></si>`,
              );
              return `<${p}c${ref} t="s"><${p}v>${i}</${p}v></${p}c>`;
            }
            if ('error' in cell)
              return `<${p}c${ref} t="e"><${p}v>${esc(cell.error)}</${p}v></${p}c>`;
            const t = typeof cell.result === 'string' ? ' t="str"' : '';
            return `<${p}c${ref}${t}><${p}f>${esc(cell.formula)}</${p}f><${p}v>${esc(String(cell.result))}</${p}v></${p}c>`;
          })
          .join('');
        if (cells === '' && !o.omitRefs) return '';
        return `<${p}row${o.omitRefs ? '' : ` r="${r + 1}"`}>${cells}</${p}row>`;
      })
      .join('');
    const ns = o.prefix
      ? 'xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
      : 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<!-- generated for tests --><${p}worksheet ${ns}><${p}sheetData>${rows}</${p}sheetData></${p}worksheet>`;
  });

  const parts: Record<string, string> = {
    '[Content_Types].xml':
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>',
    '_rels/.rels':
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
      .map(
        (s, i) =>
          `<sheet name="${esc(s.name)}" sheetId="${i + 1}"${s.hidden ? ' state="hidden"' : ''} r:id="rId${i + 1}"/>`,
      )
      .join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
      .map(
        (_, i) =>
          `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
      )
      .join('')}</Relationships>`,
    'xl/sharedStrings.xml': `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">${sharedXml.join('')}</sst>`,
  };
  sheetXml.forEach((xml, i) => {
    parts[`xl/worksheets/sheet${i + 1}.xml`] = xml;
  });
  Object.assign(parts, o.extraParts ?? {});
  for (const name of o.omit ?? []) delete parts[name];
  return zip(parts, o);
}
