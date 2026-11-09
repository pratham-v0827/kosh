'use client';

import type { PriceInfo } from '@kosh/core';
import { ageLabel } from '@kosh/prices/staleness';
import { AlertTriangle, CircleSlash } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export const SOURCE_LABELS: Record<string, string> = {
  manual: 'Manual price',
  'amfi-navall': 'AMFI NAV',
  mfapi: 'mfapi.in',
  'coindcx-ticker': 'CoinDCX',
  finnhub: 'Finnhub',
  twelvedata: 'Twelve Data',
  'frankfurter-ecb': 'ECB reference rate',
};

export const sourceLabel = (s: string) => SOURCE_LABELS[s] ?? s;

export function formatAsOf(asOf: string): string {
  const d = new Date(asOf.length === 10 ? `${asOf}T10:00:00Z` : asOf);
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    ...(asOf.length > 10 ? { hour: 'numeric', minute: '2-digit' } : {}),
  }).format(d);
}

/** Stale / missing marker. Icon + text (never colour alone), with source and date on hover. */
export function PriceBadge({
  status,
  price,
  className,
  plain = false,
}: {
  status: 'fresh' | 'stale' | 'missing';
  price: PriceInfo | null;
  className?: string;
  /** Render without a tooltip button (e.g. inside a link). */
  plain?: boolean;
}) {
  if (status === 'fresh') return null;
  const now = new Date();
  const missing = status === 'missing';
  const text = missing ? 'No price' : `Stale · ${ageLabel(price!.asOf, now)}`;
  const detail = missing
    ? price
      ? 'A USD→INR rate is needed to value this holding.'
      : 'No automatic price source for this holding yet. Set a manual price.'
    : `${sourceLabel(price!.source)} price from ${formatAsOf(price!.asOf)} IST. Refresh, or update it manually.`;
  const Icon = missing ? CircleSlash : AlertTriangle;
  const cls = cn(
    'inline-flex min-h-6 items-center gap-1 rounded-full border border-warn/40 bg-warn/10 px-2 text-xs font-medium whitespace-nowrap text-warn-fg',
    className,
  );
  if (plain) {
    return (
      <span className={cls}>
        <Icon aria-hidden className="size-3" />
        {text}
      </span>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger
        className={cn(
          'inline-flex min-h-6 items-center gap-1 rounded-full border border-warn/40 bg-warn/10 px-2 text-xs font-medium whitespace-nowrap text-warn-fg',
          className,
        )}
      >
        <Icon aria-hidden className="size-3" />
        {text}
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{detail}</TooltipContent>
    </Tooltip>
  );
}
