'use client';

import { ASSET_CLASS_LABELS } from '@kosh/contracts';
import type { AssetClass } from '@kosh/core';
import { CheckCircle2, CircleDashed } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';

interface Coverage {
  assetClass: AssetClass;
  automatic: boolean;
  providers: { id: string; label: string; configured: boolean }[];
}

const NOTE: Partial<Record<AssetClass, string>> = {
  IN_EQUITY:
    'No permitted free source yet: NSE/BSE downloads block automated clients. Use manual prices.',
  US_EQUITY: 'Needs a free Finnhub or Twelve Data API key set by whoever runs this instance.',
  UNLISTED: 'Always manual: public quotes are indicative.',
};

/** Which asset types this instance prices automatically. Booleans only; keys never leave the server. */
export function PriceSources() {
  const [rows, setRows] = useState<Coverage[] | null>(null);
  useEffect(() => {
    api<{ coverage: Coverage[] }>('/api/v1/prices/coverage')
      .then((r) => setRows(r.coverage))
      .catch(() => setRows([]));
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Price sources</CardTitle>
        <CardDescription>
          Only instrument symbols are sent to these sources, never your holdings or identity.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows === null ? (
          <Skeleton className="h-32" />
        ) : (
          <ul className="divide-y text-sm">
            {rows.map((r) => (
              <li key={r.assetClass} className="flex gap-3 py-3">
                {r.automatic ? (
                  <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-gain" />
                ) : (
                  <CircleDashed
                    aria-hidden
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                  />
                )}
                <div className="min-w-0">
                  <p className="font-medium">
                    {ASSET_CLASS_LABELS[r.assetClass]}{' '}
                    <span className="font-normal text-muted-foreground">
                      · {r.automatic ? 'automatic' : 'manual'}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {r.providers
                      .filter((p) => p.configured)
                      .map((p) => p.label)
                      .join(', ') || NOTE[r.assetClass]}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
