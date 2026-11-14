# M3 Phase 1 — parser spec for Groww and INDmoney holdings exports

**Status: draft, awaiting the owner's approval. No parser code exists yet.**

Written from two real exports inspected read-only on the owner's machine with every value masked.
This document contains structure only: no names, ids, holdings, quantities or amounts from those
files. All examples are invented.

## 1. File structures

### A. Groww — "Stocks Holdings Statement" (`.xlsx`)

| Aspect           | Finding                                                                                                                                                                                                                                               |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Container        | OOXML (zip). One sheet, `Sheet1`. Shared strings. No formulas, no merged cells, no number formats.                                                                                                                                                    |
| Rows above table | R1 `Name` + value · R2 `Unique Client Code` + value (stored as text) · R4 one cell: `Holdings statement for stocks as on DD-MM-YYYY` · R6 `Summary` · R7 `Invested Value` · R8 `Closing Value` · R9 `Unrealised P&L` (each label in A, number in B)   |
| Header row       | R11: `Stock Name`, `ISIN`, `Quantity`, `Average buy price`, `Buy value`, `Closing price`, `Closing value`, `Unrealised P&L`                                                                                                                           |
| Data             | From R12 to the last row. No footer or total row after the table.                                                                                                                                                                                     |
| Numbers          | Real numeric cells (binary doubles). No thousands separators, no currency symbols. Negatives are plain negative numbers, not brackets. `Closing value` carries floating-point noise (up to 12 decimals). Other money columns have at most 2 decimals. |
| Dates            | Only the statement date, `DD-MM-YYYY`, inside the R4 sentence. No purchase dates.                                                                                                                                                                     |
| Identifiers      | ISIN and company name. **No ticker and no exchange.**                                                                                                                                                                                                 |
| Indian vs US     | Indian only. ISIN prefix `INE` = company shares, `INF` = fund units (exchange-traded funds).                                                                                                                                                          |

### B. INDmoney — US stocks "Holdings report" (`.xls`)

| Aspect            | Finding                                                                                                                                                                                                           |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Container         | Legacy Excel binary (OLE2 compound file, BIFF8 `Workbook` stream). One sheet, `HOLDINGS_BOOK`. Shared strings. No formulas, no merged cells, all cells `General`.                                                 |
| Rows above table  | R1 `Account Details` · R2 `Broker Name` + value · R3 `Broker Account` + value · R4 `Holdings as on` + `YYYY-MM-DD` (text)                                                                                         |
| Header row        | R8: `Stock Symbol`, `Holding Since`, `Quantity`, `Avg. Price ($)`, `Total Value ($)`                                                                                                                              |
| Data              | From R9. Then blank rows, then `Disclaimer:-` and lines starting with `*`. No total row.                                                                                                                          |
| Numbers           | Binary doubles with visible noise: quantities up to 19 decimals, one in scientific notation (a near-zero leftover position); average prices with 13+ decimals.                                                    |
| Dates             | `Holding Since` is text: `DD Mon YYYY, hh:mm AM/PM`, different per holding (first purchase).                                                                                                                      |
| Identifiers       | US ticker only (one contains a dot, like `BRK.B`). **No name, no ISIN, no current price.**                                                                                                                        |
| Indian vs US      | US only (`$` columns, US broker). INDmoney's Indian-stocks statement is a different export.                                                                                                                       |
| `Total Value ($)` | Equals quantity × average price (i.e. **cost**, not market value) for most rows. It does not for a near-zero leftover row, and for one ordinary row it is negative while quantity and average price are positive. |

## 2. Column mapping

### A. Groww

| Source column                      | Normalised field       | Transform                                                                        | Example (invented)       |
| ---------------------------------- | ---------------------- | -------------------------------------------------------------------------------- | ------------------------ |
| `Stock Name`                       | `name`                 | trim, collapse spaces                                                            | `EXAMPLE INDUSTRIES LTD` |
| `ISIN`                             | `isin`                 | upper-case; must be 12 characters starting `IN`                                  | `INE000A01000`           |
| `ISIN` prefix                      | `instrumentType`       | `INE` → `STOCK`, `INF` → `ETF`                                                   | `ETF`                    |
| `Quantity`                         | `quantity`             | decimal, must be > 0                                                             | `12`                     |
| `Average buy price`                | `avgBuyPrice` (INR)    | decimal, 2 places as in the file                                                 | `1234.56`                |
| `Buy value`                        | `investedAmount` (INR) | decimal; checked against quantity × average price (± 0.05)                       | `14814.72`               |
| `Closing price`                    | `statementPrice`       | decimal; kept as the price "as on" the statement date until a live price arrives | `1300.10`                |
| `Closing value`                    | — (check only)         | rounded to 2 places; must equal quantity × closing price                         | `15601.20`               |
| `Unrealised P&L`                   | — (check only)         | must equal closing value − buy value                                             | `786.48`                 |
| R4 sentence                        | `statementDate`        | `DD-MM-YYYY` → `YYYY-MM-DD`                                                      | `2026-01-31`             |
| R7–R9 summary                      | — (reconciliation)     | compared with the column sums                                                    |                          |
| R1 `Name`, R2 `Unique Client Code` | **never stored**       | read past and discarded                                                          |                          |

### B. INDmoney (US)

| Source column       | Normalised field       | Transform                                                                                                                    | Example (invented)                     |
| ------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `Stock Symbol`      | `symbol`               | trim, upper-case; letters, digits, `.` and `-` only                                                                          | `AAPL`, `BRK.B`                        |
| `Holding Since`     | `acquiredOn`           | parse `DD Mon YYYY, hh:mm AM/PM`; keep the date                                                                              | `05 Mar 2024, 07:30 PM` → `2024-03-05` |
| `Quantity`          | `quantity`             | double → shortest decimal text → rounded half-up to 8 places; below 0.000001 → row skipped as a closed position, with a note | `1.23456789`                           |
| `Avg. Price ($)`    | `avgBuyPrice` (USD)    | rounded half-up to 6 places                                                                                                  | `187.654321`                           |
| (computed)          | `investedAmount` (USD) | quantity × average price                                                                                                     | `231.674474`                           |
| `Total Value ($)`   | — (check only)         | compared with quantity × average price; a difference above 1% becomes a row warning                                          |                                        |
| R4 `Holdings as on` | `statementDate`        | already `YYYY-MM-DD`                                                                                                         | `2026-01-31`                           |
| R2 `Broker Name`    | — (detection only)     |                                                                                                                              |                                        |
| R3 `Broker Account` | **never stored**       | read past and discarded                                                                                                      |                                        |
| (not in file)       | `name`                 | looked up with the price; the ticker until then                                                                              |                                        |

## 3. Normalised holding

The brief's model, with five additions (marked +):

| Field                                           | Notes                                                                     |
| ----------------------------------------------- | ------------------------------------------------------------------------- |
| `source`, `broker`                              | `groww` / `indmoney`; account ids `import:groww`, `import:indmoney-us`    |
| `assetClass`                                    | `IN_EQUITY` or `US_EQUITY`                                                |
| `instrumentType` +                              | `STOCK` or `ETF` (see decision 2)                                         |
| `exchange`                                      | `NSE` / `BSE` once resolved; none for US                                  |
| `symbol`, `isin`                                | whichever the file gives; the other is filled by resolution when possible |
| `name`                                          | from the file, or looked up                                               |
| `quantity`                                      | decimal string, up to 8 places                                            |
| `avgBuyPrice`, `investedAmount`, `currency`     | decimal strings in the holding's currency                                 |
| `statementDate` +                               | the "as on" date of the file                                              |
| `acquiredOn` +                                  | first-purchase date when the file has one (INDmoney); absent for Groww    |
| `statementPrice` +                              | closing price in the file when it has one (Groww)                         |
| `warnings` +                                    | row-level notes shown in the preview                                      |
| `importedAt`, `parserVersion`, `sourceFileHash` | on the import record; SHA-256 of the file bytes                           |

Money and quantities are decimal strings from the moment a cell is read. The files themselves
store binary doubles, so each number is converted exactly once, at the cell, using its shortest
exact decimal text and then rounded to the stated precision. No arithmetic is done on floats.

### How a holdings statement enters the ledger

A holdings statement is a snapshot, not a trade history. Each holding becomes one opening lot:
quantity at the average buy price, dated `acquiredOn` when the file gives it, otherwise the
statement date. What this means for the numbers:

| Figure                                       | Groww file                                    | INDmoney file                                                      |
| -------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------ |
| Value, invested, P&L, day change, allocation | exact                                         | exact (USD × exchange rate)                                        |
| XIRR / CAGR                                  | not available: the file has no purchase dates | approximate: all cost is dated at the first purchase               |
| Short/long-term indicator                    | not available                                 | approximate                                                        |
| Rupee cost of US holdings                    | —                                             | approximate: converted at the first-purchase date's reference rate |

These are labelled in the UI, never shown as exact.

### Re-import

A newer statement from the same broker **replaces** that broker's statement holdings. The preview
shows a diff: added, removed, changed (quantity or average price) and unchanged. The same file
again (same SHA-256) is recognised and does nothing. A file with an older statement date than the
current one needs an explicit confirmation.

## 4. Symbol resolution

| Source   | Given       | Resolution                                                                                                                                          |
| -------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| INDmoney | US ticker   | Used directly (`BRK.B` → Yahoo `BRK-B`, already supported). Name fetched with the first price.                                                      |
| Groww    | ISIN + name | 1. shared cache `isinMap/{ISIN}` (public data, no user information) → 2. Yahoo search by ISIN, preferring the NSE listing, else BSE → 3. unresolved |

- Yahoo's search endpoint is unofficial, like the price endpoint Kosh already uses. Checked on
  2026-11-14 with two public ISINs (a company share and an ETF); both returned the NSE ticker.
  It follows the existing `ENABLE_UNOFFICIAL_YAHOO` switch: with it off, every Groww row needs
  manual mapping.
- NSE and BSE publish official ISIN lists, but both refuse automated clients (ADR-0019).
- **Unresolved rows are never dropped.** They are imported under their ISIN, valued at the
  statement's closing price (marked stale), flagged in the preview and in an "unmapped" list, and
  the user can type the ticker. Mapping moves the holding to the ticker's identity so that it
  consolidates with the same stock held elsewhere.
- Each ISIN is looked up once and cached for everyone; lookups are throttled and capped per run
  like other Yahoo calls.

## 5. Reconciliation

| Check                                               | Groww                                                  | INDmoney                    |
| --------------------------------------------------- | ------------------------------------------------------ | --------------------------- |
| Rows parsed = rows in the table                     | yes                                                    | yes                         |
| Σ `Buy value` vs `Invested Value`                   | differs by 0.004% (rounded average prices in the rows) | no totals in the file       |
| Σ `Closing value` vs `Closing Value`                | equal to the paisa                                     | —                           |
| Σ `Unrealised P&L` vs summary                       | same 0.004% gap, same cause                            | —                           |
| Per row: quantity × average price = buy/total value | all rows exact                                         | all but two rows (see §1 B) |
| Per row: quantity × closing price = closing value   | all rows exact                                         | —                           |

Proposed tolerance for file totals: the larger of ₹1 per row and 0.05% of the total. Inside it:
"reconciled", with the difference shown. Outside it: a warning in the preview; the import is
still allowed after an explicit confirmation.

## 6. Detection

By content, never by file name.

| Parser                   | Signature                                                                                                                  |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `groww.holdings@1`       | a header row containing `Stock Name`, `ISIN`, `Average buy price`, `Closing value`; `Unique Client Code` label above it    |
| `indmoney.us-holdings@1` | a header row containing `Stock Symbol`, `Holding Since`, `Avg. Price ($)`, `Total Value ($)`; `Broker Name` label above it |

The header row is found by scanning, not by row number, and columns are matched by name, so extra
or reordered columns are tolerated. Helpful "this looks like a different report" messages will
cover only formats that have been seen; the Groww order-history layout has not been (unverified).

## 7. Reading the files safely

Cells are data only: formulas are never evaluated, and text beginning with `=`, `+`, `-` or `@` is
stored and shown as plain text. Hard limits apply before and during reading: 4 MB file, a cap on
decompressed size (zip bombs), on sheets, rows and cells, and a time budget.
