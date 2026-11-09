'use client';

import { ShieldCheck, LineChart, FileUp, Bot } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Logo } from '@/components/logo';
import { useAuth } from '@/components/providers/auth-provider';
import { Button } from '@/components/ui/button';

const FEATURES = [
  {
    icon: LineChart,
    title: 'All of it in one place',
    body: 'Indian and US stocks, mutual funds, unlisted shares and crypto, valued in rupees.',
  },
  {
    icon: FileUp,
    title: 'Official routes only',
    body: 'Broker APIs where they exist, your own export files where they don’t. Never your broker password.',
  },
  {
    icon: ShieldCheck,
    title: 'Private by design',
    body: 'Uploaded files are discarded after reading. Admins can’t see your holdings. Open source.',
  },
  {
    icon: Bot,
    title: 'Ask Claude (coming)',
    body: 'Connect Claude to your own portfolio through a private, read-only MCP server.',
  },
];

export default function Landing() {
  const { user, loading } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (!loading && user) router.replace('/dashboard');
  }, [loading, user, router]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-6">
      <header className="flex items-center justify-between">
        <Logo />
        <Button asChild variant="outline" size="sm">
          <Link href="/sign-in">Sign in</Link>
        </Button>
      </header>

      <main className="flex flex-1 flex-col justify-center gap-12 py-16">
        <section className="max-w-2xl space-y-5">
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            Every investment. One ledger.
          </h1>
          <p className="text-lg text-muted-foreground">
            Kosh is an open-source portfolio tracker for Indian investors. See your real net worth,
            P&amp;L and returns across every broker, fund and exchange you use.
          </p>
          <Button asChild size="lg">
            <Link href="/sign-in">Get started, it’s free</Link>
          </Button>
        </section>

        <ul className="grid gap-4 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <li key={f.title} className="flex gap-3 rounded-xl border bg-card p-5">
              <f.icon aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
              <div>
                <h2 className="font-medium">{f.title}</h2>
                <p className="text-sm text-muted-foreground">{f.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </main>

      <footer className="text-xs text-muted-foreground">
        Not investment advice. Not affiliated with Zerodha, Groww, INDmoney, CAMS, KFintech,
        CoinDCX, NSE, BSE or AMFI.
      </footer>
    </div>
  );
}
