'use client';

import { fieldErrors, TransactionInput } from '@kosh/contracts';
import { type FormEvent, type ReactNode, useState } from 'react';
import { toast } from 'sonner';
import { Field, todayIST } from '@/components/field';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api, ApiRequestError } from '@/lib/api';
import type { TxnRow } from '@/lib/hooks';

type Kind = 'BUY' | 'SELL' | 'DIVIDEND' | 'FEE' | 'SPLIT' | 'BONUS';

export const TXN_LABELS: Record<Kind | 'OPENING_BALANCE', string> = {
  BUY: 'Buy',
  SELL: 'Sell',
  DIVIDEND: 'Dividend',
  FEE: 'Charge / fee',
  SPLIT: 'Split',
  BONUS: 'Bonus issue',
  OPENING_BALANCE: 'Opening balance',
};

export function TransactionDialog({
  instrumentId,
  currency = 'INR',
  existing,
  trigger,
}: {
  instrumentId: string;
  currency?: 'INR' | 'USD';
  existing?: TxnRow;
  trigger: ReactNode;
}) {
  const usd = currency === 'USD';
  const sym = usd ? '$' : '₹';
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<Kind>((existing?.type as Kind | undefined) ?? 'BUY');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const editing = Boolean(existing);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => (f.get(k) as string | null)?.trim() || undefined;
    const common = { type, instrumentId, tradeDate: s('tradeDate') ?? '', note: s('note') };
    const candidate =
      type === 'BUY' || type === 'SELL'
        ? { ...common, qty: s('qty'), price: s('price'), fees: s('fees'), fxRate: s('fxRate') }
        : type === 'DIVIDEND' || type === 'FEE'
          ? { ...common, amount: s('amount'), fxRate: s('fxRate') }
          : { ...common, ratio: { from: Number(s('from')), to: Number(s('to')) } };
    const parsed = TransactionInput.safeParse(candidate);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await api(editing ? `/api/v1/transactions/${existing!.id}` : '/api/v1/transactions', {
        method: editing ? 'PATCH' : 'POST',
        body: parsed.data,
      });
      toast.success(editing ? 'Transaction updated' : 'Transaction added');
      setOpen(false);
    } catch (err) {
      if (err instanceof ApiRequestError && Object.keys(err.fields).length) setErrors(err.fields);
      else setErrors({ _: err instanceof Error ? err.message : 'Could not save' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setErrors({});
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} noValidate className="space-y-4">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit transaction' : 'Add transaction'}</DialogTitle>
            <DialogDescription>
              {editing
                ? 'The original entry is kept in history; the corrected one replaces it.'
                : 'Your cost, P&L and returns update immediately.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="txn-type">Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as Kind)} disabled={editing}>
              <SelectTrigger id="txn-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(['BUY', 'SELL', 'DIVIDEND', 'FEE', 'SPLIT', 'BONUS'] as const).map((k) => (
                  <SelectItem key={k} value={k}>
                    {TXN_LABELS[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="txn-date"
              label={type === 'SPLIT' || type === 'BONUS' ? 'Ex-date' : 'Date'}
              error={errors.tradeDate}
            >
              <Input
                name="tradeDate"
                type="date"
                defaultValue={existing?.tradeDate ?? todayIST()}
                max={todayIST()}
              />
            </Field>

            {(type === 'BUY' || type === 'SELL') && (
              <>
                <Field id="txn-qty" label="Quantity" error={errors.qty}>
                  <Input
                    name="qty"
                    inputMode="decimal"
                    defaultValue={existing?.qty}
                    autoComplete="off"
                  />
                </Field>
                <Field id="txn-price" label={`Price per unit (${sym})`} error={errors.price}>
                  <Input
                    name="price"
                    inputMode="decimal"
                    defaultValue={existing?.price}
                    autoComplete="off"
                  />
                </Field>
                <Field id="txn-fees" label={`Charges (${sym}, optional)`} error={errors.fees}>
                  <Input
                    name="fees"
                    inputMode="decimal"
                    defaultValue={existing?.fees}
                    autoComplete="off"
                  />
                </Field>
              </>
            )}

            {(type === 'DIVIDEND' || type === 'FEE') && (
              <Field id="txn-amount" label={`Amount (${sym})`} error={errors.amount}>
                <Input
                  name="amount"
                  inputMode="decimal"
                  defaultValue={existing?.amount}
                  autoComplete="off"
                />
              </Field>
            )}

            {(type === 'SPLIT' || type === 'BONUS') && (
              <div className="space-y-1.5 sm:col-span-2">
                <span className="text-sm font-medium" id="ratio-label">
                  {type === 'SPLIT' ? 'Each old share becomes' : 'Free shares for every share held'}
                </span>
                <div className="flex items-center gap-2" role="group" aria-labelledby="ratio-label">
                  <Input
                    aria-label={type === 'SPLIT' ? 'Old shares' : 'Shares held'}
                    name="from"
                    inputMode="numeric"
                    defaultValue={existing?.ratio?.from ?? 1}
                    className="w-20"
                  />
                  <span aria-hidden>:</span>
                  <Input
                    aria-label={type === 'SPLIT' ? 'New shares' : 'Bonus shares'}
                    name="to"
                    inputMode="numeric"
                    defaultValue={existing?.ratio?.to ?? (type === 'SPLIT' ? 2 : 1)}
                    className="w-20"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {type === 'SPLIT'
                    ? 'A 1:2 split turns 10 shares into 20. Total cost is unchanged.'
                    : 'A 1:1 bonus gives 1 free share per share held, at zero cost.'}
                </p>
                {errors['ratio.from'] || errors['ratio.to'] ? (
                  <p className="text-xs font-medium text-destructive">
                    Use whole numbers, e.g. 1 and 2.
                  </p>
                ) : null}
              </div>
            )}

            {usd && type !== 'SPLIT' && type !== 'BONUS' && (
              <Field
                id="txn-fx"
                label="USD→INR rate (optional)"
                hint="Blank = ECB reference rate for that date."
                error={errors.fxRate}
              >
                <Input
                  name="fxRate"
                  inputMode="decimal"
                  defaultValue={existing?.fxRate}
                  autoComplete="off"
                />
              </Field>
            )}

            <div className="sm:col-span-2">
              <Field id="txn-note" label="Note (optional)" error={errors.note}>
                <Input
                  name="note"
                  maxLength={200}
                  defaultValue={existing?.note}
                  autoComplete="off"
                />
              </Field>
            </div>
          </div>

          {errors._ && (
            <p role="alert" className="text-sm text-destructive">
              {errors._}
            </p>
          )}

          <DialogFooter>
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : editing ? 'Save changes' : 'Add'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
