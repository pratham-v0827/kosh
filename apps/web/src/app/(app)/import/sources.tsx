'use client';

import type { Timestamp } from 'firebase/firestore';
import { CheckCircle2, Circle, Download } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/** What the source cards need from an import record. */
export interface SourceImport {
  parser: string;
  status: 'draft' | 'confirmed' | 'undone';
  statementDate?: string;
  createdAt: Timestamp | null;
}

interface Source {
  /** Parser id (without version). */
  parser: string;
  name: string;
  file: string;
  how: string;
  /** Menu paths come from third-party guides and are not verified. */
  unverifiedPath?: boolean;
  template?: boolean;
}

const SOURCES: Source[] = [
  {
    parser: 'groww.holdings',
    name: 'Groww',
    file: 'Indian stocks: holdings statement (.xlsx)',
    how: 'Profile → Reports → Stocks → Holdings statement. Upload it as downloaded.',
    unverifiedPath: true,
  },
  {
    parser: 'indmoney.us-holdings',
    name: 'INDmoney',
    file: 'US stocks: holdings report (.xls)',
    how: 'Profile → Tax and Other Reports → Other Reports → US Stocks → Holdings.',
    unverifiedPath: true,
  },
  {
    parser: 'kosh.csv',
    name: 'Any other broker',
    file: 'Kosh CSV template (.csv)',
    how: 'One row per buy, sell, dividend, split or bonus. Copy them from your broker’s trade report.',
    template: true,
  },
];

const day = (t: Timestamp | null) =>
  t
    ? new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }).format(t.toDate())
    : 'just now';

const asOn = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${iso}T00:00:00Z`));

/** One card per supported source: which file, how to get it, and when it was last imported. */
export function SourcesCard({
  imports,
  limits,
}: {
  imports: readonly SourceImport[];
  limits: { maxRowsPerFile: number; rowsPerDay: number } | null;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Your sources</CardTitle>
        <CardDescription>
          Upload any of these above; Kosh recognises the format by itself.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-3 md:grid-cols-3">
          {SOURCES.map((s) => {
            const last = imports.find(
              (i) => i.status === 'confirmed' && i.parser.startsWith(`${s.parser}@`),
            );
            return (
              <li key={s.parser} className="flex flex-col gap-2 rounded-xl border p-4 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-medium">{s.name}</h3>
                  {last ? (
                    <CheckCircle2 aria-hidden className="size-4 shrink-0 text-gain" />
                  ) : (
                    <Circle aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                  )}
                </div>
                <p className="text-muted-foreground">{s.file}</p>
                <p>{s.how}</p>
                {s.unverifiedPath && (
                  <p className="text-xs text-muted-foreground">
                    Menu path from third-party guides; it may have moved.
                  </p>
                )}
                {s.template && (
                  <>
                    <a
                      href="/templates/kosh-import-template.csv"
                      download
                      className="inline-flex min-h-6 items-center gap-1 text-primary underline-offset-2 hover:underline"
                    >
                      <Download aria-hidden className="size-4" /> Download the template
                    </a>
                    {limits && (
                      <p className="text-xs text-muted-foreground">
                        Up to {limits.maxRowsPerFile} rows per file and {limits.rowsPerDay} rows a
                        day. Split longer histories by year.
                      </p>
                    )}
                  </>
                )}
                <p className="mt-auto pt-1 text-xs text-muted-foreground">
                  {last
                    ? `Last imported ${day(last.createdAt)}${last.statementDate ? `, statement as on ${asOn(last.statementDate)}` : ''}.`
                    : 'Not imported yet.'}
                </p>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">
          Not supported yet: Zerodha and other brokers’ own files, CoinDCX, and consolidated account
          statements (CAS). Use the CSV template for them meanwhile.
        </p>
      </CardContent>
    </Card>
  );
}
