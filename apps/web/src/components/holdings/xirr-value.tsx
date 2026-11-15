'use client';

import type { XirrNote, XirrSummary } from '@kosh/core';
import { useFormat } from '@/components/providers/settings-provider';

const WHY: Record<XirrNote | Exclude<XirrSummary['reason'], 'OK'>, string> = {
  NO_DATES: 'No purchase dates',
  NO_DATA: 'No purchase dates',
  TOO_SHORT: 'Under 30 days',
  NO_PRICE: 'No price',
  NO_FX: 'No exchange rate',
  NOT_COMPUTABLE: 'Not computable',
};

/**
 * An XIRR figure, or in words why there is none. "≈" marks approximate purchase dates.
 * `data-volatile`: the figure ages by the day (end-to-end screenshots mask it).
 */
export function XirrValue({
  rate,
  why,
  approximate,
}: {
  rate: number | null;
  why: XirrNote | XirrSummary['reason'] | null;
  approximate: boolean;
}) {
  const f = useFormat();
  if (rate === null) {
    return (
      <span className="text-xs text-muted-foreground">
        {why && why !== 'OK' ? WHY[why] : 'Not available'}
      </span>
    );
  }
  return (
    <span data-volatile>
      {approximate && (
        <>
          <span aria-hidden>≈ </span>
          <span className="sr-only">approximately </span>
        </>
      )}
      {f.percent(rate, { signed: true, decimals: 1 })}
    </span>
  );
}
