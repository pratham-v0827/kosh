'use client';

import { fieldErrors, ManualPriceInput } from '@kosh/contracts';
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
import { api } from '@/lib/api';

export function PriceDialog({
  instrumentId,
  currency = 'INR',
  current,
  trigger,
}: {
  instrumentId: string;
  currency?: 'INR' | 'USD';
  current?: string;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const parsed = ManualPriceInput.safeParse({
      price: String(f.get('price') ?? '').trim(),
      asOf: String(f.get('asOf') ?? ''),
    });
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setBusy(true);
    try {
      await api(`/api/v1/instruments/${encodeURIComponent(instrumentId)}/price`, {
        method: 'PUT',
        body: parsed.data,
      });
      toast.success('Price updated');
      setOpen(false);
    } catch (err) {
      setErrors({ _: err instanceof Error ? err.message : 'Could not save' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={submit} noValidate className="space-y-4">
          <DialogHeader>
            <DialogTitle>Update price</DialogTitle>
            <DialogDescription>
              A manual price. If an automatic source later has a newer price, that is used instead.
              Unlisted-share quotes are indicative and vary between sites.
            </DialogDescription>
          </DialogHeader>
          <Field
            id="manual-price"
            label={`Price per unit (${currency === 'USD' ? '$' : '₹'})`}
            error={errors.price}
          >
            <Input name="price" inputMode="decimal" defaultValue={current} autoComplete="off" />
          </Field>
          <Field id="manual-asof" label="As of" error={errors.asOf}>
            <Input name="asOf" type="date" defaultValue={todayIST()} max={todayIST()} />
          </Field>
          {errors._ && (
            <p role="alert" className="text-sm text-destructive">
              {errors._}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save price'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
