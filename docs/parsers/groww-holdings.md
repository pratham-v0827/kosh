# Groww stocks holdings statement (`groww.holdings@1`)

Imports the **Holdings statement** for stocks that Groww exports as an Excel file (`.xlsx`):
Indian shares and exchange-traded funds held in your Groww demat account.

## Getting the file

In Groww: **Profile → Reports → Stocks → Holdings statement** (menu path from third-party guides;
unverified, it may have moved). Download it and upload it to Kosh as it is. Do not open and
re-save it: that can change number formats.

## What Kosh reads

| In the file                                  | Used for                                                            |
| -------------------------------------------- | ------------------------------------------------------------------- |
| `Stock Name`                                 | the holding's name                                                  |
| `ISIN`                                       | identifying the holding; `INF…` ISINs are marked as ETFs            |
| `Quantity`, `Average buy price`, `Buy value` | quantity and cost                                                   |
| `Closing price`                              | a first price, as on the statement date, until a live price arrives |
| "Holdings statement for stocks as on …"      | the statement date                                                  |
| `Invested Value`, `Closing Value` (summary)  | checking that the rows add up                                       |

Your **name** and **Unique Client Code** are read past and never stored. The file itself is
discarded after reading; Kosh keeps only a SHA-256 of it, to recognise the same file again.

The table is found by its column names, wherever it starts, so extra or reordered columns are
fine.

## What you see before anything changes

- **Does the file add up?** The sum of the rows against the file's own totals. Groww's "Invested
  Value" is computed from unrounded average prices, so a difference of a few rupees is normal and
  shown as "within rounding" (allowed: ₹1 per row or 0.05%, whichever is larger).
- **New / Changed / Removed / Unchanged** compared with the Groww statement you imported before.
- **Left out:** rows that could not be read (with the reason), and rows with zero quantity.

## Things to know

- **A statement replaces the previous one.** Importing a newer statement updates your Groww
  holdings to match it. The same file again does nothing. An older file needs you to tick a box.
- **No purchase dates.** The statement lists what you hold, not when you bought it. Value, cost,
  profit and day change are exact; **XIRR is not shown** for these holdings. Each holding keeps
  the date of the first statement that listed it.
- **Tickers.** The file has ISINs, not exchange tickers. Kosh looks each ISIN up once (Yahoo
  Finance search, unofficial; switched off by `ENABLE_UNOFFICIAL_YAHOO=false`) and remembers the
  answer. A holding it cannot match is still imported, valued at the statement's closing price,
  and listed under **Holdings that need a ticker**, where you can type the NSE or BSE ticker.
- **Missing rows are never guessed.** If any row could not be read, holdings absent from the file
  are kept rather than removed.
- **Undo** removes what that import added. It does not bring back an earlier statement; import
  that statement again if you want it.

## Not supported

Groww's order history and mutual-fund statements are different files and are not read by this
parser.
