'use client';

import { Columns3 } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/** Optional columns of the holdings table. Name, Value and P&L are always shown. */
export const COLUMNS = [
  { id: 'qty', label: 'Quantity' },
  { id: 'avgCost', label: 'Average cost' },
  { id: 'price', label: 'Price' },
  { id: 'invested', label: 'Invested' },
  { id: 'day', label: 'Day change' },
  { id: 'xirr', label: 'XIRR' },
  { id: 'weight', label: 'Weight' },
  { id: 'brokers', label: 'Brokers' },
] as const;
export type ColumnId = (typeof COLUMNS)[number]['id'];

const DEFAULT: ColumnId[] = ['qty', 'avgCost', 'price', 'day', 'xirr'];
const KEY = 'kosh.holdings.columns';
const isColumn = (v: unknown): v is ColumnId => COLUMNS.some((c) => c.id === v);

function load(): Set<ColumnId> {
  try {
    const raw = window.localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : null;
    if (Array.isArray(list)) return new Set(list.filter(isColumn));
  } catch {
    // storage blocked or corrupt: use the defaults
  }
  return new Set(DEFAULT);
}

/** The chosen columns, remembered on this device (a convenience; never needed for correctness). */
export function useColumns() {
  const [shown, setShown] = useState<Set<ColumnId>>(() =>
    typeof window === 'undefined' ? new Set(DEFAULT) : load(),
  );
  const toggle = useCallback((id: ColumnId, on: boolean) => {
    setShown((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      try {
        window.localStorage.setItem(KEY, JSON.stringify([...next]));
      } catch {
        // not remembered; still applied
      }
      return next;
    });
  }, []);
  return { shown, toggle };
}

export function ColumnChooser({
  shown,
  toggle,
}: {
  shown: Set<ColumnId>;
  toggle: (id: ColumnId, on: boolean) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <Columns3 aria-hidden /> Columns
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Show columns</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {COLUMNS.map((c) => (
          <DropdownMenuCheckboxItem
            key={c.id}
            checked={shown.has(c.id)}
            onCheckedChange={(on) => toggle(c.id, on === true)}
            onSelect={(e) => e.preventDefault()} // keep the menu open while choosing
          >
            {c.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
