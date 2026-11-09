import { xirr } from '@kosh/core';
import { CheckCircle2, XCircle } from 'lucide-react';
import Image from 'next/image';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { AuthDemo } from '@/components/auth-demo';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { checkFirestore } from '@/server/health';

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });
const pct = new Intl.NumberFormat('en-IN', { style: 'percent', minimumFractionDigits: 2 });

// Microsoft's XIRR documentation example: expected 37.34%.
const sample = xirr([
  { date: '2008-01-01', amount: -10000 },
  { date: '2008-03-01', amount: 2750 },
  { date: '2008-10-30', amount: 4250 },
  { date: '2009-02-15', amount: 3250 },
  { date: '2009-04-01', amount: 2750 },
]);

async function FirestoreStatus() {
  await connection(); // request-time only
  const health = await checkFirestore();
  if (!health.ok) {
    return (
      <div className="flex items-start gap-2 text-sm">
        <XCircle aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
        <div>
          <p className="font-medium">Not connected</p>
          <p className="text-muted-foreground">{health.error}</p>
          <p className="mt-1 text-muted-foreground">
            Start the emulators with <code className="font-mono">pnpm dev:all</code>.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2 text-sm">
      <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-gain" />
      <div>
        <p className="font-medium">
          Connected to {health.emulator ? 'Firestore emulator' : 'Firestore'} ✓
        </p>
        <p className="num text-muted-foreground">
          Project {health.projectId} · round trip {health.roundTripMs} ms · ping #{health.pings}
        </p>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-12 sm:py-20">
      <header className="flex items-center gap-4">
        <Image src="/kosh-mark.svg" alt="" width={56} height={56} priority />
        <div>
          <h1 className="text-4xl font-semibold tracking-tight">kosh</h1>
          <p className="text-muted-foreground">Every investment. One ledger.</p>
        </div>
        <Badge variant="secondary" className="ml-auto">
          M0 · scaffold
        </Badge>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Database</CardTitle>
            <CardDescription>Server → Firestore round trip</CardDescription>
          </CardHeader>
          <CardContent>
            <Suspense fallback={<Skeleton className="h-10 w-full" />}>
              <FirestoreStatus />
            </Suspense>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Sign-in</CardTitle>
            <CardDescription>Browser → Auth emulator</CardDescription>
          </CardHeader>
          <CardContent>
            <AuthDemo />
          </CardContent>
        </Card>

        <Card className="sm:col-span-2">
          <CardHeader>
            <CardTitle>Portfolio maths</CardTitle>
            <CardDescription>
              <code className="font-mono">@kosh/core</code> self-check against a known XIRR value
            </CardDescription>
          </CardHeader>
          <CardContent className="num flex flex-wrap items-baseline gap-x-8 gap-y-2">
            <p>
              <span className="text-sm text-muted-foreground">XIRR (Excel reference) </span>
              <span className="text-2xl font-semibold">
                {sample.ok ? pct.format(sample.rate) : sample.reason}
              </span>
              <span className="text-sm text-muted-foreground"> expected 37.34%</span>
            </p>
            <p>
              <span className="text-sm text-muted-foreground">Indian format </span>
              <span className="text-2xl font-semibold">{inr.format(4218560.5)}</span>
            </p>
          </CardContent>
        </Card>
      </div>

      <footer className="mt-auto text-xs text-muted-foreground">
        Not investment advice. Not affiliated with any broker, registrar or exchange.
      </footer>
    </main>
  );
}
