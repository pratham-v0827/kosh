'use client';

import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/components/providers/auth-provider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { clientDb } from '@/lib/firebase/client';

interface Unmapped {
  id: string;
  name: string;
  isin: string;
}

/**
 * Holdings imported under their ISIN because no exchange ticker was found. They are valued at
 * the statement's closing price until the user gives them a ticker here.
 */
export function UnmappedHoldings() {
  const { user } = useAuth();
  const [items, setItems] = useState<Unmapped[]>([]);
  const [values, setValues] = useState<Record<string, { symbol: string; exchange: 'NSE' | 'BSE' }>>(
    {},
  );
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    // Instruments without a ticker; those that came from a statement carry an ISIN.
    const q = query(
      collection(clientDb(), `users/${user.uid}/instruments`),
      where('symbol', '==', null),
    );
    return onSnapshot(
      q,
      (s) =>
        setItems(
          s.docs
            .filter((d) => typeof d.get('isin') === 'string' && d.get('assetClass') === 'IN_EQUITY')
            .map((d) => ({
              id: d.id,
              name: d.get('name') as string,
              isin: d.get('isin') as string,
            })),
        ),
      () => setItems([]), // the list is a convenience; the holdings themselves are unaffected
    );
  }, [user]);

  if (items.length === 0) return null;

  async function save(item: Unmapped) {
    const v = values[item.id];
    if (!v || v.symbol.trim() === '') return;
    setSaving(item.id);
    try {
      await api(`/api/v1/instruments/${encodeURIComponent(item.id)}/symbol`, {
        method: 'PUT',
        body: { symbol: v.symbol.trim(), exchange: v.exchange },
      });
      toast.success(`${item.name} is now tracked as ${v.symbol.trim().toUpperCase()}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the ticker');
    } finally {
      setSaving(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Holdings that need a ticker</CardTitle>
        <CardDescription>
          Kosh could not match these to an exchange ticker, so they show the price from your
          statement. Type the NSE or BSE ticker to get live prices.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-2">
              <div className="min-w-48 flex-1">
                <div className="font-medium">{item.name}</div>
                <div className="num text-xs text-muted-foreground">{item.isin}</div>
              </div>
              <label className="sr-only" htmlFor={`map-${item.id}`}>
                Ticker for {item.name}
              </label>
              <Input
                id={`map-${item.id}`}
                placeholder="Ticker"
                className="h-9 w-40"
                value={values[item.id]?.symbol ?? ''}
                onChange={(e) =>
                  setValues((v) => ({
                    ...v,
                    [item.id]: {
                      symbol: e.target.value.toUpperCase(),
                      exchange: v[item.id]?.exchange ?? 'NSE',
                    },
                  }))
                }
              />
              <select
                aria-label={`Exchange for ${item.name}`}
                className="h-9 rounded-md border bg-background px-2 text-sm"
                value={values[item.id]?.exchange ?? 'NSE'}
                onChange={(e) =>
                  setValues((v) => ({
                    ...v,
                    [item.id]: {
                      symbol: v[item.id]?.symbol ?? '',
                      exchange: e.target.value as 'NSE' | 'BSE',
                    },
                  }))
                }
              >
                <option value="NSE">NSE</option>
                <option value="BSE">BSE</option>
              </select>
              <Button
                size="sm"
                disabled={saving !== null || !(values[item.id]?.symbol ?? '').trim()}
                onClick={() => save(item)}
              >
                {saving === item.id && <Loader2 aria-hidden className="animate-spin" />}
                Save
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
