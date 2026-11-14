/**
 * A tiny, forgiving XML scanner for the handful of spreadsheet parts Kosh reads.
 *
 * It only uses `indexOf` and slices, so its running time is linear in the input: there is no
 * regular expression that an attacker-chosen file could make slow. Custom entities are never
 * expanded (no "billion laughs"), and nothing outside the given string is ever fetched (no XXE).
 */
export interface XmlHandlers {
  /** `attr(name)` returns the decoded attribute value, or undefined. Names are without prefix. */
  open?(name: string, attr: (name: string) => string | undefined, selfClosing: boolean): void;
  close?(name: string): void;
  text?(text: string): void;
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Decode the five predefined entities and numeric character references. Linear time. */
export function decodeEntities(s: string): string {
  let amp = s.indexOf('&');
  if (amp === -1) return s;
  let out = '';
  let pos = 0;
  while (amp !== -1) {
    out += s.slice(pos, amp);
    const semi = s.indexOf(';', amp + 1);
    // entity names are short; anything else is kept as literal text
    if (semi === -1 || semi - amp > 12) {
      out += '&';
      pos = amp + 1;
    } else {
      const name = s.slice(amp + 1, semi);
      let ch: string | undefined = NAMED[name];
      if (ch === undefined && name[0] === '#') {
        const hex = name[1] === 'x' || name[1] === 'X';
        const code = Number.parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10);
        if (Number.isInteger(code) && code > 0 && code <= 0x10ffff) ch = String.fromCodePoint(code);
      }
      out += ch ?? s.slice(amp, semi + 1);
      pos = semi + 1;
    }
    amp = s.indexOf('&', pos);
  }
  return out + s.slice(pos);
}

const isSpace = (c: string | undefined) => c === ' ' || c === '\n' || c === '\r' || c === '\t';

/** Drop a namespace prefix: "x:row" → "row". */
const local = (name: string) => {
  const colon = name.indexOf(':');
  return colon === -1 ? name : name.slice(colon + 1);
};

/** Find `name="value"` (or single quotes) in a tag's attribute text. `name` may carry a prefix. */
function attribute(attrs: string, name: string): string | undefined {
  let from = 0;
  for (;;) {
    const at = attrs.indexOf(name, from);
    if (at === -1) return undefined;
    const before = attrs[at - 1];
    const eq = at + name.length;
    // must be a whole attribute name: preceded by whitespace (or a prefix colon) and followed by =
    if ((at === 0 || isSpace(before) || before === ':') && attrs[eq] === '=') {
      const quote = attrs[eq + 1];
      if (quote === '"' || quote === "'") {
        const end = attrs.indexOf(quote, eq + 2);
        if (end !== -1) return decodeEntities(attrs.slice(eq + 2, end));
      }
      return undefined;
    }
    from = at + name.length;
  }
}

export function scanXml(xml: string, h: XmlHandlers): void {
  const n = xml.length;
  let pos = 0;
  while (pos < n) {
    const lt = xml.indexOf('<', pos);
    if (lt === -1) {
      h.text?.(decodeEntities(xml.slice(pos)));
      return;
    }
    if (lt > pos) h.text?.(decodeEntities(xml.slice(pos, lt)));

    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt + 4);
      pos = end === -1 ? n : end + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt + 9);
      h.text?.(xml.slice(lt + 9, end === -1 ? n : end));
      pos = end === -1 ? n : end + 3;
      continue;
    }
    const gt = xml.indexOf('>', lt + 1);
    if (gt === -1) return; // truncated tag: stop quietly
    const first = xml[lt + 1];
    if (first === '?' || first === '!') {
      pos = gt + 1; // declaration, processing instruction or DOCTYPE: ignored
      continue;
    }
    if (first === '/') {
      h.close?.(local(xml.slice(lt + 2, gt).trim()));
      pos = gt + 1;
      continue;
    }
    const selfClosing = xml[gt - 1] === '/';
    const inner = xml.slice(lt + 1, selfClosing ? gt - 1 : gt);
    let nameEnd = 0;
    while (nameEnd < inner.length && !isSpace(inner[nameEnd])) nameEnd++;
    const name = local(inner.slice(0, nameEnd));
    const attrs = inner.slice(nameEnd);
    h.open?.(name, (a) => attribute(attrs, a), selfClosing);
    if (selfClosing) h.close?.(name);
    pos = gt + 1;
  }
}
