'use client';

import { RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { api, ApiRequestError } from '@/lib/api';
import { useBook } from '@/lib/hooks';
import { cn } from '@/lib/utils';

const fmtIST = (d: Date) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);

interface RefreshResult {
  unpriced: string[];
  problems: { provider: string; message: string }[];
}

/** "Last refreshed: 9 Nov, 7:42 pm IST" + Refresh. Always visible in the app header. */
export function RefreshControl({ compact = false }: { compact?: boolean }) {
  const book = useBook();
  const [busy, setBusy] = useState(false);
  const last = book.status === 'ready' ? book.data?.lastRefresh : undefined;
  const at = last?.at
    ? typeof last.at.toDate === 'function'
      ? last.at.toDate()
      : new Date(last.at as never)
    : null;

  async function refresh() {
    setBusy(true);
    try {
      const r = await api<RefreshResult>('/api/v1/refresh', { method: 'POST' });
      if (r.unpriced.length > 0) {
        toast.success('Prices updated', {
          description: `${r.unpriced.length} holding${r.unpriced.length > 1 ? 's have' : ' has'} no automatic price source.`,
        });
      } else {
        toast.success('Prices updated');
      }
    } catch (e) {
      if (e instanceof ApiRequestError && e.status === 429) toast.info(e.message);
      else toast.error(e instanceof Error ? e.message : 'Refresh failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <p
        className={cn('text-xs text-muted-foreground', compact && 'hidden sm:block')}
        aria-live="polite"
      >
        {at ? (
          <>
            Last refreshed <time dateTime={at.toISOString()}>{fmtIST(at)} IST</time>
          </>
        ) : book.status === 'ready' ? (
          'Not refreshed yet'
        ) : null}
      </p>
      <Button
        variant="outline"
        size="sm"
        onClick={refresh}
        disabled={busy}
        aria-label="Refresh prices"
      >
        <RefreshCw aria-hidden className={cn(busy && 'animate-spin')} />
        <span className={cn(compact && 'sr-only sm:not-sr-only')}>
          {busy ? 'Refreshing…' : 'Refresh'}
        </span>
      </Button>
    </div>
  );
}
