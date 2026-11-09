'use client';

import { ASSET_CLASS_LABELS, fieldErrors, ManualHoldingInput } from '@kosh/contracts';
import { ASSET_CLASSES, type AssetClass } from '@kosh/core';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { Field, todayIST } from '@/components/field';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api, ApiRequestError } from '@/lib/api';

const SYMBOL_HINT: Record<AssetClass, string> = {
  IN_EQUITY: 'ISIN (e.g. INE002A01018) or NSE symbol.',
  US_EQUITY: 'Ticker, e.g. AAPL.',
  MUTUAL_FUND: 'AMFI scheme code (e.g. 120590) or ISIN. Needed for automatic daily NAV.',
  UNLISTED: 'Optional. ISIN if the company has one.',
  CRYPTO: 'Coin symbol, e.g. BTC. Priced from the CoinDCX INR market.',
};

const PRICE_HINT: Record<AssetClass, string> = {
  IN_EQUITY:
    'Indian share prices are manual for now: there is no permitted free automatic source yet. Enter today’s price and update it when you like.',
  US_EQUITY:
    'Priced automatically when the instance has a free Finnhub or Twelve Data key; otherwise enter it here (in $).',
  MUTUAL_FUND: 'Optional. With a scheme code, Kosh uses the official AMFI NAV on every refresh.',
  UNLISTED:
    'Kosh can’t fetch unlisted prices. Enter the latest indicative price you trust; you can update it anytime.',
  CRYPTO: 'Optional. With a coin symbol, Kosh uses the CoinDCX INR price on every refresh.',
};

export default function NewManualHoldingPage() {
  const router = useRouter();
  const [assetClass, setAssetClass] = useState<AssetClass>('UNLISTED');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => (f.get(k) as string | null)?.trim() || undefined;
    const candidate = {
      instrument: { name: s('name') ?? '', assetClass, symbol: s('symbol') },
      qty: s('qty') ?? '',
      price: s('price') ?? '',
      fees: s('fees'),
      fxRate: s('fxRate'),
      tradeDate: s('tradeDate') ?? '',
      currentPrice: s('currentPrice'),
      note: s('note'),
    };
    const parsed = ManualHoldingInput.safeParse(candidate);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const r = await api<{ instrumentId: string }>('/api/v1/holdings/manual', {
        method: 'POST',
        body: parsed.data,
      });
      toast.success(`${parsed.data.instrument.name} added`);
      router.push(`/holdings/${encodeURIComponent(r.instrumentId)}`);
    } catch (err) {
      if (err instanceof ApiRequestError && Object.keys(err.fields).length) setErrors(err.fields);
      toast.error(err instanceof Error ? err.message : 'Could not add the holding');
    } finally {
      setBusy(false);
    }
  }

  const unlisted = assetClass === 'UNLISTED';
  const usd = assetClass === 'US_EQUITY';
  const sym = usd ? '$' : '₹';

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Add a holding</h1>
        <p className="text-sm text-muted-foreground">
          For unlisted shares, or anything you want to track by hand. Imports from brokers and CAS
          arrive in a later release.
        </p>
      </div>

      <form onSubmit={submit} noValidate>
        <Card>
          <CardHeader>
            <CardTitle>What you hold</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <label htmlFor="assetClass" className="text-sm font-medium">
                Type
              </label>
              <Select value={assetClass} onValueChange={(v) => setAssetClass(v as AssetClass)}>
                <SelectTrigger id="assetClass" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASSET_CLASSES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {ASSET_CLASS_LABELS[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Field
              id="name"
              label={unlisted ? 'Company name' : 'Name'}
              error={errors['instrument.name']}
            >
              <Input
                name="name"
                autoComplete="off"
                maxLength={120}
                placeholder={unlisted ? 'e.g. Acme Technologies' : ''}
              />
            </Field>
            <Field
              id="symbol"
              label="Symbol / ISIN"
              hint={SYMBOL_HINT[assetClass]}
              error={errors['instrument.symbol']}
            >
              <Input name="symbol" autoComplete="off" maxLength={32} className="uppercase" />
            </Field>
          </CardContent>

          <CardHeader className="pt-2">
            <CardTitle>Purchase</CardTitle>
            <CardDescription>
              Add more purchases or sales from the holding page afterwards.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field id="qty" label="Quantity" error={errors.qty}>
              <Input name="qty" inputMode="decimal" autoComplete="off" />
            </Field>
            <Field id="price" label={`Buy price per unit (${sym})`} error={errors.price}>
              <Input name="price" inputMode="decimal" autoComplete="off" />
            </Field>
            <Field
              id="fees"
              label={`Charges (${sym}, optional)`}
              hint="Brokerage, stamp duty, etc. Added to your cost."
              error={errors.fees}
            >
              <Input name="fees" inputMode="decimal" autoComplete="off" />
            </Field>
            <Field id="tradeDate" label="Buy date" error={errors.tradeDate}>
              <Input name="tradeDate" type="date" defaultValue={todayIST()} max={todayIST()} />
            </Field>
            {usd && (
              <Field
                id="fxRate"
                label="USD→INR rate you paid (optional)"
                hint="Blank = ECB reference rate for the buy date."
                error={errors.fxRate}
              >
                <Input name="fxRate" inputMode="decimal" autoComplete="off" />
              </Field>
            )}
          </CardContent>

          <CardHeader className="pt-2">
            <CardTitle>Current price</CardTitle>
            <CardDescription>{PRICE_HINT[assetClass]}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field
              id="currentPrice"
              label={`Current price per unit (${sym}, optional)`}
              error={errors.currentPrice}
            >
              <Input name="currentPrice" inputMode="decimal" autoComplete="off" />
            </Field>
            <Field id="note" label="Note (optional)" error={errors.note}>
              <Input name="note" maxLength={200} autoComplete="off" />
            </Field>
          </CardContent>

          <CardContent className="flex justify-end gap-2 border-t pt-4">
            <Button type="button" variant="ghost" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Adding…' : 'Add holding'}
            </Button>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
