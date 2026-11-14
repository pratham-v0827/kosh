# Kosh CSV template (`kosh.csv@1`)

A plain CSV you fill in yourself. It works for any source, and it is the reference format for the
import framework. Download a ready-made copy from **Import → Download the template** in the app,
or use [the file in this repository](../../apps/web/public/templates/kosh-import-template.csv).

One row is one event: a buy, a sale, a dividend, a charge, a split or a bonus.

## Columns

The first row must be the header. Column order does not matter; `Trade Date`, `trade-date` and
`trade_date` style variations of the names below are accepted.

| Column        | Required                | What to put in it                                                                                 |
| ------------- | ----------------------- | ------------------------------------------------------------------------------------------------- |
| `date`        | always                  | `2025-03-14`, or day-first `14-03-2025` / `14/03/2025`. Month-first dates are not accepted.       |
| `type`        | always                  | `buy`, `sell`, `dividend`, `fee`, `split` or `bonus`                                              |
| `asset_class` | always                  | `in_equity`, `us_equity`, `mutual_fund`, `unlisted` or `crypto`                                   |
| `name`        | always                  | Company, fund or coin name (up to 120 characters)                                                 |
| `symbol`      | for automatic prices    | NSE/BSE ticker (`RELIANCE`, `M&M`), US ticker (`AAPL`), AMFI scheme code (`120590`), coin (`BTC`) |
| `exchange`    | optional, Indian stocks | `NSE` (default) or `BSE`                                                                          |
| `quantity`    | buy, sell               | Units, up to 10 decimal places                                                                    |
| `price`       | buy, sell               | Price per unit, in rupees (US stocks: in US dollars)                                              |
| `fees`        | optional, buy, sell     | Brokerage, taxes and charges for that trade                                                       |
| `amount`      | dividend, fee           | Cash amount                                                                                       |
| `ratio`       | split, bonus            | `1:2` = each share becomes 2 (split) or 2 free shares per 1 held (bonus)                          |
| `fx_rate`     | optional, US stocks     | Rupees per US dollar that you paid. Blank = the ECB reference rate for that date is looked up.    |
| `reference`   | optional                | The broker's order or trade id. Makes duplicate detection exact.                                  |
| `note`        | optional                | Free text, up to 200 characters                                                                   |

Numbers may use thousands separators (`1,23,456.50`) and a currency symbol. Negative numbers,
formulas (`=A1+B1`) and scientific notation are rejected.

## Rules

- **Dates** cannot be in the future (India time).
- **A sale needs earlier purchases in the same file or an earlier import.** Imported holdings are
  kept separate from holdings you added by hand, so a sale in a file cannot draw on a manual entry.
- **Limits:** 4 MB and 450 rows per file, 2,000 imported rows a day. Split long histories by year.
- **Text only:** the file must be CSV in UTF-8. From Excel, use _Save as → CSV UTF-8_.

## What happens on import

1. Kosh reads the file in memory and discards it. The file and its name are never stored.
2. You get a preview with three lists: **New**, **Already imported** and **Needs attention**.
3. Nothing changes until you press **Import**. You can untick individual rows first.
4. Every import can be undone from **Import history**.

### Duplicates

Each row gets a fingerprint from its source, date, holding, type, quantity, price or amount, and
reference. A row whose fingerprint is already in your ledger is skipped, so importing the same
file twice, or two files that overlap, never doubles your holdings.

Two rows in one file that are identical in every one of those fields (for example two equal SIP
purchases on the same day) are both kept: they are numbered in file order.

Fees and notes are not part of the fingerprint. If you correct only the fees of a row and import
again, the row counts as already imported; undo the first import to replace it.

### Rows that need attention

A row is set aside, with its row number and the reason, when:

- a required value is missing or not a valid date or number;
- the symbol contains characters other than letters, digits, `.`, `-` and `&`;
- a US row has no `fx_rate` and no reference rate could be found for its date;
- it cannot apply to your holdings, for example a sale of more units than you hold.

Fix those rows in the file and upload it again. The rows that were already imported are skipped.
