# M3 Phase 3 — UI/UX gap analysis

**Status: draft for the owner's approval. Nothing in this document is built yet.**

Research done 2026-11-15 with web search. Competitor claims come from search-result summaries of
each vendor's own pages and third-party reviews; I did not open each page or use the products, so
every claim below is marked **unverified** unless stated otherwise. Links are at the end.

## 1. What leading trackers offer (unverified, as of 2026-11-15)

| Tool                                   | Notable features found                                                                                                                                                                                                                     |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Sharesight** (paid, global)          | Benchmark a portfolio or one holding against any stock, ETF or fund; Diversity report by market, sector, industry, country, custom groups, at any past date; contribution analysis; drawdown risk. Free tier limited to 10 holdings. [1–4] |
| **Ghostfolio** (open source)           | X-ray: rule-based checks for concentration and diversification, with adjustable thresholds; benchmark comparison; Zen mode (values hidden); dark theme. [5–7]                                                                              |
| **Wealthfolio** (open source, desktop) | Allocation charts and heatmaps, benchmarking, dividend/interest income tracking, multi-currency, goals; data stays local. [8–10]                                                                                                           |
| **INDmoney**                           | Net worth incl. PMS and gold; family accounts; portfolio XIRR shown next to a benchmark's XIRR; US stocks vs S&P 500, Indian stocks vs Nifty 50; goals. [11–15]                                                                            |
| **Zerodha Console**                    | Holdings filters by account, asset class, sector, type, tags; holdings as on a past date; Analytics: dividends, red flags, top contributors, events timeline; portfolio XIRR (current or historical). [16–18]                              |
| **Kuvera**                             | Nothing current found by search (results were about Kubera, a different product). Left out.                                                                                                                                                |

## 2. Gap analysis

"Ours today" was checked against the code on 2026-11-15.

| Feature                                                              | Leading tools                       | Ours today                                                                        | Plan                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Net-worth hero: value, invested, P&L, day change                     | all                                 | ✅ KPI cards                                                                      | **Keep**; add portfolio XIRR, "Last refreshed" with source badges in the hero                                                                                                                                                                     |
| Portfolio XIRR                                                       | INDmoney, Zerodha                   | ❌ per holding only                                                               | **Build**; exclude holdings without purchase dates and say so                                                                                                                                                                                     |
| Value over time with 1W/1M/3M/6M/1Y/All                              | Sharesight, Ghostfolio, Wealthfolio | ❌ data exists (snapshots, yearly series), no chart                               | **Build** (needs a chart library, §4)                                                                                                                                                                                                             |
| Benchmark: Nifty 50 / Sensex / S&P 500                               | Sharesight, INDmoney, Ghostfolio    | ❌                                                                                | **Build** as "benchmark XIRR": the same dated cash flows invested in the index. Index prices from Yahoo (`^NSEI`, `^BSESN`, `^GSPC`; unofficial, same switch). Meaningless for holdings without dates, so those are excluded and the UI says so   |
| Allocation by asset class                                            | all                                 | ✅ by cost, bars                                                                  | **Upgrade**: by value and cost, donut                                                                                                                                                                                                             |
| Allocation by broker, geography (IN/US), instrument type (ETF/stock) | Sharesight, Zerodha                 | ❌ data exists (account, currency, `instrumentType`)                              | **Build**                                                                                                                                                                                                                                         |
| Allocation by market cap (large/mid/small, India)                    | INDmoney-style apps                 | ❌                                                                                | **Build** from AMFI's half-yearly categorisation list (official, free, `amfiindia.com` already allow-listed). Download link and columns **unverified**: check before building                                                                     |
| Allocation by sector                                                 | Sharesight, Zerodha                 | ❌                                                                                | **Defer**: no free, official, automation-friendly source for Indian stocks (NSE blocks automated clients, ADR-0019). US-only via SEC EDGAR SIC codes is possible but needs a contact e-mail in the User-Agent. Option: user-editable tags instead |
| Treemap / heatmap of holdings                                        | Wealthfolio                         | ❌                                                                                | **Build** (size = value, colour = day change), with a table fallback                                                                                                                                                                              |
| Consolidated holdings across brokers with per-broker breakdown       | — (table stakes)                    | ⚠️ rows are grouped by instrument; no per-broker breakdown; combined XIRR missing | **Build**: expandable per-broker rows, weighted average cost, combined XIRR                                                                                                                                                                       |
| Holdings table: sort, search, filter                                 | Zerodha                             | ✅ sort, search, asset-class tabs                                                 | **Add** broker filter and a column chooser                                                                                                                                                                                                        |
| Mobile: tables become cards                                          | —                                   | ✅ holdings list                                                                  | **Extend** to new tables                                                                                                                                                                                                                          |
| Holding detail: price chart                                          | Sharesight                          | ❌                                                                                | **Build** from Yahoo daily history (cached); manual/unlisted show their price history                                                                                                                                                             |
| Insights: top gainers/losers, concentration, holding period          | Ghostfolio X-ray, Zerodha red flags | ❌                                                                                | **Build**: top movers (day), concentration > threshold (default 10%, adjustable), short vs long term (informational, with "not tax advice"). "Not investment advice" note on the panel                                                            |
| INR / USD view                                                       | Sharesight, Wealthfolio             | ❌ INR only, USD holdings shown converted                                         | **Build**: toggle in the header, with rate and date shown                                                                                                                                                                                         |
| Privacy mode (mask values)                                           | Ghostfolio (Zen mode)               | ❌                                                                                | **Build**: one click and a shortcut; percentages stay visible; remembered per device                                                                                                                                                              |
| Command palette (Ctrl/Cmd+K), shortcuts                              | —                                   | ❌                                                                                | **Build**: go to pages and holdings, toggle privacy/currency/theme, start an import, refresh; `?` lists shortcuts                                                                                                                                 |
| Import centre: per-broker status, last import, re-import             | —                                   | ⚠️ history list only                                                              | **Build**: one card per broker with last statement date, holdings count, re-import, warnings                                                                                                                                                      |
| Light/dark from design tokens                                        | all                                 | ✅                                                                                | **Keep**; audit contrast of new charts                                                                                                                                                                                                            |
| Skeletons, empty states, inline error recovery                       | —                                   | ⚠️ some pages                                                                     | **Extend** to every new view; reserve space to avoid layout shift                                                                                                                                                                                 |
| Motion respecting reduced-motion                                     | —                                   | ❌ none, which is safe                                                            | **Add sparingly**: chart and expand transitions, off under `prefers-reduced-motion`                                                                                                                                                               |
| Indian / international number format                                 | —                                   | ✅                                                                                | **Keep**; apply to charts and tooltips                                                                                                                                                                                                            |
| Accessibility WCAG 2.2 AA                                            | —                                   | ⚠️ built with care, not audited                                                   | **Audit with axe in E2E** (Phase 5); new AA items: targets ≥ 24 px (2.5.8), focus not obscured by the sticky header (2.4.11) [19–20]                                                                                                              |
| Dividends / income tracking                                          | Sharesight, Wealthfolio, Zerodha    | ⚠️ manual entry only                                                              | **Defer** to the broker trade imports                                                                                                                                                                                                             |
| Goals, family accounts                                               | INDmoney, Wealthfolio               | ❌                                                                                | **Out of scope** for M3                                                                                                                                                                                                                           |

## 3. Proposed M3 set, in build order

1. **Data and maths in `@kosh/core`** (tested first): portfolio and combined XIRR, consolidation by
   instrument with per-broker rows, allocation groupings, insights, benchmark XIRR, value-series
   ranges.
2. **Dashboard**: hero (XIRR, last refreshed, sources), value-over-time chart with ranges,
   benchmark card, allocation (donut and treemap, switchable grouping), insights panel.
3. **Holdings**: consolidated rows with per-broker breakdown, broker filter, column chooser;
   holding detail price chart.
4. **App-wide**: INR/USD toggle, privacy mode, command palette and shortcuts.
5. **Import centre**: per-broker cards.
6. **Polish**: skeletons, empty and error states, reduced-motion, mobile at 360 px.

Deferred: sector allocation, dividends, goals, family accounts.

## 4. Choices that need the owner's decision

1. **Chart library.** Recommended: **Recharts** (MIT, React, SVG, no paid tier) for line, area
   and donut charts, plus a small hand-written SVG treemap. Alternative: hand-written SVG for
   everything (no dependency, more work, harder to make accessible).
2. **Benchmark data from Yahoo's unofficial endpoint** (`^NSEI`, `^BSESN`, `^GSPC`), behind the
   existing `ENABLE_UNOFFICIAL_YAHOO` switch. No free official index feed was found.
3. **Market-cap categories from AMFI's list** (to be verified at build time), refreshed twice a
   year by the daily job.
4. **Sector allocation deferred** (recommended), or US-only via SEC EDGAR with the self-hoster's
   contact e-mail in an environment variable.

## Sources (searched 2026-11-15)

1. [Sharesight: performance tracking features](https://www.sharesight.com/blog/how-to-get-the-most-out-of-sharesights-performance-tracking-features)
2. [Sharesight: 5 ways to get portfolio insights](https://www.sharesight.com/blog/5-ways-to-get-the-portfolio-insights-you-need)
3. [Freenance: Sharesight review 2026](https://freenance.io/products/sharesight-review-2026-portfolio-tracker-dividend-tracking-tax/)
4. [TradingTools: Sharesight](https://tradingtools-directory.pages.dev/tools/sharesight/)
5. [Ghostfolio README](https://cdn.jsdelivr.net/gh/ghostfolio/ghostfolio@main/README.md)
6. [openapps.pro: Ghostfolio](https://openapps.pro/apps/ghostfolio)
7. [freedom251.com: Ghostfolio](https://freedom251.com/apps/ghostfolio/)
8. [Wealthfolio on GitHub](https://github.com/wealthfolio/wealthfolio)
9. [toolradar: Wealthfolio](https://toolradar.com/tools/wealthfolio)
10. [findmymoat: Wealthfolio](https://www.findmymoat.com/tools/wealthfolio)
11. [INDmoney: net worth](https://www.indmoney.com/networth)
12. [INDmoney: family accounts](https://www.indmoney.com/networth/family-accounts)
13. [INDmoney: US stocks portfolio analytics](https://www.indmoney.com/us-stocks/portfolio-analytics)
14. [INDmoney: Indian stocks portfolio analytics](https://www.indmoney.com/stocks/portfolio-analytics)
15. [INDmoney: track external mutual funds](https://www.indmoney.com/features/track-mutual-funds)
16. [Zerodha: Console analytics](https://support.zerodha.com/category/console/portfolio/console-holdings/articles/console-analytics)
17. [Zerodha: portfolio XIRR](https://support.zerodha.com/category/console/portfolio/console-holdings/articles/portfolio-xirr)
18. [TradingQnA: new Holdings page on Console](https://tradingqna.com/t/introducing-the-new-holdings-page-on-console/196840)
19. [W3C: What's new in WCAG 2.2](https://w3.org/WAI/standards-guidelines/wcag/new-in-22/)
20. [WebAIM: WCAG 2.2](https://webaim.org/standards/wcag/wcag22)

Data sources (searched 2026-11-15, unverified): AMFI categorisation
([amfipy data dictionary](https://skamalj.github.io/amfipy/data/research/),
[Trendlyne help](https://help.trendlyne.com/support/solutions/articles/84000391102-how-are-stocks-categorized-into-large-medium-and-small-cap-categories-));
SEC EDGAR ([DEV Community](https://dev.to/ronin13/sec-filings-have-a-free-json-api-pull-any-companys-10-ks-8-ks-and-insider-trades-without-a-key-23b1));
Yahoo index symbols ([yahoofinancer](https://rdrr.io/cran/yahoofinancer/src/R/index.R),
[IBKR Campus](https://www.interactivebrokers.com/campus/ibkr-quant-news/r-code-snippet-read-historical-prices-of-stock-index/)).
