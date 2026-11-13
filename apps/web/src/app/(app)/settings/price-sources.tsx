'use client';

import { CheckCircle2, CircleDashed } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';

interface Coverage {
  route: string;
  label: string;
  automatic: boolean;
  providers: { id: string; label: string; unofficial: boolean; configured: boolean }[];
}

const NOTE: Record<string, string> = {
  UNLISTED: 'Always manual: public quotes are indicative dealer prices.',
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
          In order of preference. Only instrument symbols are sent, never your holdings or identity.
          Sources marked unofficial can change or stop without notice.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows === null ? (
          <Skeleton className="h-32" />
        ) : (
          <ul className="divide-y text-sm">
            {rows.map((r) => {
              const usable = r.providers.filter((p) => p.configured);
              return (
                <li key={r.route} className="flex gap-3 py-3">
                  {r.automatic ? (
                    <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-gain" />
                  ) : (
                    <CircleDashed
                      aria-hidden
                      className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                    />
                  )}
                  <div className="min-w-0 space-y-1">
                    <p className="font-medium">
                      {r.label}{' '}
                      <span className="font-normal text-muted-foreground">
                        · {r.automatic ? 'automatic' : 'manual'}
                      </span>
                    </p>
                    {usable.length > 0 ? (
                      <ol className="flex flex-wrap gap-1.5">
                        {usable.map((p, i) => (
                          <li key={p.id}>
                            <Badge variant={p.unofficial ? 'outline' : 'secondary'}>
                              {i + 1}. {p.label}
                            </Badge>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        {NOTE[r.route] ??
                          'No source configured on this instance. Use manual prices.'}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
