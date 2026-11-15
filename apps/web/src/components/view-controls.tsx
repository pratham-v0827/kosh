'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useFormat } from '@/components/providers/settings-provider';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/** Header toggles: privacy mode (hide amounts) and rupee / dollar view. Remembered per device. */
export function ViewControls() {
  const f = useFormat();
  const { hidden, currency } = f.view;
  const usd = currency === 'USD';

  return (
    <div className="flex items-center gap-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-pressed={hidden}
            aria-label="Hide amounts"
            onClick={() => f.setView({ hidden: !hidden })}
          >
            {hidden ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {hidden ? 'Amounts hidden. Show them' : 'Hide amounts'} (Shift+H)
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={usd}
            aria-label="Show amounts in US dollars"
            disabled={!f.usdInr && !usd}
            onClick={() => f.setView({ currency: usd ? 'INR' : 'USD' })}
            className="num w-12 font-semibold"
          >
            {usd ? '$' : '₹'}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {f.usdInr
            ? `${usd ? 'Showing US dollars' : 'Show US dollars'} at ₹${Number(f.usdInr.rate).toFixed(2)} per $ (${f.usdInr.asOf}) (Shift+U)`
            : 'Dollar view needs the exchange rate (appears after a refresh)'}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
