# INDmoney US stocks holdings report (`indmoney.us-holdings@1`)

Imports the **Holdings report** for US stocks that INDmoney exports as a legacy Excel file
(`.xls`): US shares, including fractional shares, in US dollars.

## Getting the file

In INDmoney: **Profile → Tax and Other Reports → Other Reports → US Stocks → Holdings** (menu
path from third-party guides; unverified, it may have moved). Upload the downloaded file as it is.

INDmoney's report for **Indian** stocks is a different file and is not read by this parser.

## What Kosh reads

| In the file       | Used for                                             |
| ----------------- | ---------------------------------------------------- |
| `Stock Symbol`    | the US ticker (`BRK.B`-style tickers are fine)       |
| `Holding Since`   | the date of your first purchase                      |
| `Quantity`        | quantity, rounded to 8 decimal places                |
| `Avg. Price ($)`  | average buy price in US dollars, rounded to 6 places |
| `Total Value ($)` | a check only (see below)                             |
| `Holdings as on`  | the statement date                                   |

Your **broker account number** is read past and never stored. The file is discarded after
reading; Kosh keeps only a SHA-256 of it, to recognise the same file again.

The report has no company names, so a holding shows its ticker until a price lookup supplies the
name.

## Things to know

- **Cost is quantity × average price.** In these reports `Total Value ($)` is the cost, not the
  market value, and on some rows it does not equal quantity × average price (it can even be
  negative after partial sales). Kosh uses quantity × average price and marks such rows.
- **Leftover crumbs are skipped.** A position you sold completely can remain in the report with a
  quantity like 0.000000000000004. Anything under 0.000001 of a share is listed under **Left out**
  as a closed position.
- **Rupee cost and XIRR are approximate.** The report gives only the first purchase date, so all
  of a holding's cost is converted at that date's reference exchange rate (European Central Bank
  rate via Frankfurter) and dated there. The holding page labels XIRR as approximate. Dollar
  figures are exact.
- **No totals to check against.** The report has no summary, so the reconciliation shows the row
  count and the row-by-row arithmetic only.
- **A statement replaces the previous one**, with a preview of what is new, changed, removed and
  unchanged. The same file again does nothing.
- **Undo** removes what that import added.
