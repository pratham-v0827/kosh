import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Terms' };

// Template for instance operators. Have it reviewed by a lawyer before a public launch (docs/PLAN.md §9.5).
export default function TermsPage() {
  return (
    <>
      <h1>Terms of use</h1>
      <p className="text-muted-foreground">
        Version 2026-11-09 · Template: the operator of this instance must review it.
      </p>
      <h2>What Kosh is</h2>
      <p>
        Kosh is open-source software that helps you record and understand your own investments. It
        shows descriptive figures (values, profit and loss, returns, allocation) based on the data
        you provide.
      </p>
      <h2>Not investment advice</h2>
      <p>
        Nothing in Kosh, including its emails and its Claude connector, is investment, tax or legal
        advice, or a recommendation to buy or sell anything.
      </p>
      <h2>No affiliation</h2>
      <p>
        Kosh is not affiliated with Zerodha, Groww, INDmoney, CAMS, KFintech, MFCentral, CoinDCX,
        NSE, BSE, AMFI or any broker, registrar or exchange.
      </p>
      <h2>Your responsibilities</h2>
      <ul>
        <li>
          Check that what you enter or import is accurate. Prices may be delayed, indicative or
          wrong.
        </li>
        <li>Keep your sign-in method secure. Kosh never asks for your broker password.</li>
        <li>You must be 18 or older.</li>
      </ul>
      <h2>No warranty</h2>
      <p>
        The software is provided “as is”, without warranty of any kind, as described in its
        open-source licence (AGPL-3.0).
      </p>
    </>
  );
}
