'use client';

import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { useFormat } from '@/components/providers/settings-provider';
import { cn } from '@/lib/utils';

/**
 * Gain/loss figure. Colour is never the only signal: it always carries a sign, an arrow and a
 * screen-reader label ("gain of …" / "loss of …").
 */
export function Change({
  value,
  pct,
  compact = false,
  className,
  showPct = true,
  stacked = false,
}: {
  value: string | number | null;
  pct?: number | null;
  compact?: boolean;
  className?: string;
  showPct?: boolean;
  /** Put the percentage on its own line (for narrow KPI cards). */
  stacked?: boolean;
}) {
  const f = useFormat();
  if (value === null || value === undefined) {
    return <span className={cn('text-muted-foreground', className)}>—</span>;
  }
  const n = Number(value);
  const dir = n > 0 ? 'gain' : n < 0 ? 'loss' : 'flat';
  const Icon = n > 0 ? ArrowUpRight : n < 0 ? ArrowDownRight : null;
  const money = f.money(n, { signed: true, compact });
  const percent = pct === null || pct === undefined ? null : f.percent(pct, { signed: true });
  const label =
    dir === 'flat'
      ? `no change${percent ? `, ${percent}` : ''}`
      : `${dir} of ${f.money(Math.abs(n), { compact })}${percent ? `, ${percent}` : ''}`;

  return (
    <span
      className={cn(
        'num inline-flex items-center gap-0.5 font-medium whitespace-nowrap',
        dir === 'gain' && 'text-gain',
        dir === 'loss' && 'text-loss',
        className,
      )}
    >
      <span className="sr-only">{label}</span>
      <span
        aria-hidden
        className={cn('inline-flex gap-0.5', stacked ? 'flex-col items-start' : 'items-center')}
      >
        <span className="inline-flex items-center gap-0.5">
          {Icon && <Icon className="size-4 shrink-0" />}
          {money}
        </span>
        {showPct && percent && (
          <span className={cn('font-normal', stacked ? 'text-sm' : 'ml-1')}>({percent})</span>
        )}
      </span>
    </span>
  );
}

export function Money({
  value,
  compact = false,
  className,
}: {
  value: string | number | null | undefined;
  compact?: boolean;
  className?: string;
}) {
  const f = useFormat();
  if (value === null || value === undefined)
    return <span className="text-muted-foreground">—</span>;
  return (
    <span className={cn('num whitespace-nowrap', className)}>{f.money(value, { compact })}</span>
  );
}
