/** One spreadsheet cell as data. Formulas are never evaluated: only their stored result is read. */
export type Cell = { t: 's'; v: string } | { t: 'n'; v: number } | { t: 'b'; v: boolean } | null;

export interface Sheet {
  name: string;
  hidden: boolean;
  /** Dense rows from the top of the sheet; missing cells are null. Row 0 is spreadsheet row 1. */
  rows: Cell[][];
}

export interface Workbook {
  format: 'xlsx' | 'xls';
  sheets: Sheet[];
}

/** Hard ceilings applied while reading. Exceeding one aborts with an ImportError. */
export interface SheetLimits {
  /** Total bytes after decompression (zip-bomb guard). */
  maxUncompressedBytes: number;
  maxSheets: number;
  maxRows: number;
  maxCols: number;
  /** Non-empty cells across the workbook. */
  maxCells: number;
  /** Characters in one text cell. Longer text is cut, never rejected. */
  maxStringChars: number;
}

export const DEFAULT_SHEET_LIMITS: SheetLimits = {
  maxUncompressedBytes: 32 * 1024 * 1024,
  maxSheets: 20,
  maxRows: 5000,
  maxCols: 60,
  maxCells: 100_000,
  maxStringChars: 2000,
};

/** Collects cells for one sheet while enforcing the limits. */
export class SheetBuilder {
  private readonly rows: Cell[][] = [];

  constructor(
    readonly name: string,
    readonly hidden: boolean,
    private readonly limits: SheetLimits,
    private readonly budget: { cells: number },
    private readonly fail: (message: string) => never,
  ) {}

  set(row: number, col: number, cell: Exclude<Cell, null>): void {
    if (row < 0 || col < 0) return;
    if (row >= this.limits.maxRows) this.fail('The sheet has too many rows');
    if (col >= this.limits.maxCols) this.fail('The sheet has too many columns');
    if (++this.budget.cells > this.limits.maxCells) this.fail('The file has too many cells');
    if (cell.t === 's' && cell.v.length > this.limits.maxStringChars) {
      cell = { t: 's', v: cell.v.slice(0, this.limits.maxStringChars) };
    }
    while (this.rows.length <= row) this.rows.push([]);
    const r = this.rows[row]!;
    while (r.length < col) r.push(null);
    r[col] = cell;
  }

  build(): Sheet {
    return { name: this.name, hidden: this.hidden, rows: this.rows };
  }
}
