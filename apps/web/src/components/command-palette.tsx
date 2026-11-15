'use client';

import { groupByInstrument } from '@kosh/core';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useFormat } from '@/components/providers/settings-provider';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { type Command, isTypingTarget, matchCommands } from '@/lib/commands';
import { useBook } from '@/lib/hooks';
import { cn } from '@/lib/utils';

const OPEN_EVENT = 'kosh:command-palette';

/** Open the palette from anywhere (for example a menu item). */
export function openCommandPalette() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

const PAGES: [href: string, label: string][] = [
  ['/dashboard', 'Dashboard'],
  ['/holdings', 'Holdings'],
  ['/history', 'History'],
  ['/import', 'Import a file'],
  ['/manual/new', 'Add a holding'],
  ['/settings', 'Settings'],
];

type Runnable = Command & { run: () => void };

/**
 * Ctrl/⌘+K: jump to a page or holding, or switch the view. Shift+H hides amounts, Shift+U switches
 * rupees / dollars (never while typing in a field).
 */
export function CommandPalette() {
  const router = useRouter();
  const f = useFormat();
  const book = useBook();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const { hidden, currency } = f.view;
  const { setView } = f;
  const canUsd = f.usdInr !== null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || !e.shiftKey) return;
      if (isTypingTarget(document.activeElement as HTMLElement | null)) return;
      if (e.code === 'KeyH') {
        e.preventDefault();
        setView({ hidden: !hidden });
      } else if (e.code === 'KeyU' && (canUsd || currency === 'USD')) {
        e.preventDefault();
        setView({ currency: currency === 'USD' ? 'INR' : 'USD' });
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, [hidden, currency, canUsd, setView]);

  const holdings = book.status === 'ready' ? book.data?.holdings : undefined;
  const commands = useMemo<Runnable[]>(() => {
    const go = (href: string) => () => router.push(href);
    const list: Runnable[] = PAGES.map(([href, label]) => ({
      id: `page:${href}`,
      label,
      group: 'Pages',
      run: go(href),
    }));
    list.push({
      id: 'view:hidden',
      label: hidden ? 'Show amounts' : 'Hide amounts',
      hint: 'Shift+H',
      group: 'View',
      run: () => setView({ hidden: !hidden }),
    });
    if (canUsd || currency === 'USD') {
      list.push({
        id: 'view:currency',
        label: currency === 'USD' ? 'Show amounts in rupees' : 'Show amounts in US dollars',
        hint: 'Shift+U',
        group: 'View',
        run: () => setView({ currency: currency === 'USD' ? 'INR' : 'USD' }),
      });
    }
    for (const r of holdings ? groupByInstrument(holdings) : []) {
      list.push({
        id: `holding:${r.instrumentId}`,
        label: r.name,
        ...(r.symbol ? { hint: r.symbol } : {}),
        group: 'Holdings',
        run: go(`/holdings/${encodeURIComponent(r.instrumentId)}`),
      });
    }
    return list;
  }, [router, hidden, currency, canUsd, setView, holdings]);

  const results = useMemo(() => matchCommands(commands, q), [commands, q]);
  const current = Math.min(active, Math.max(results.length - 1, 0));
  const optionId = (i: number) => `cmd-option-${i}`;

  useEffect(() => {
    if (open) document.getElementById(optionId(current))?.scrollIntoView({ block: 'nearest' });
  }, [open, current]);

  const choose = (c: Runnable | undefined) => {
    if (!c) return;
    setOpen(false);
    c.run();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setQ('');
          setActive(0);
        }
      }}
    >
      <DialogContent className="gap-0 p-0 sm:max-w-lg" showCloseButton={false}>
        <DialogTitle className="sr-only">Search and commands</DialogTitle>
        <DialogDescription className="sr-only">
          Type to find a page, a holding or a view setting. Use the arrow keys and Enter.
        </DialogDescription>
        <input
          role="combobox"
          aria-expanded
          aria-controls="cmd-list"
          aria-activedescendant={results.length ? optionId(current) : undefined}
          aria-label="Search pages, holdings and commands"
          placeholder="Search pages, holdings and commands…"
          className="h-12 w-full rounded-t-lg border-b bg-transparent px-4 text-sm outline-none"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((current + 1) % Math.max(results.length, 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((current - 1 + results.length) % Math.max(results.length, 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              choose(results[current]);
            }
          }}
        />
        <ul
          id="cmd-list"
          role="listbox"
          aria-label="Results"
          className="max-h-80 overflow-y-auto p-1"
        >
          {results.length === 0 && (
            <li role="presentation" className="px-3 py-6 text-center text-sm text-muted-foreground">
              Nothing matches “{q}”.
            </li>
          )}
          {results.map((c, i) => (
            <li key={c.id} role="presentation">
              {(i === 0 || results[i - 1]!.group !== c.group) && (
                <p role="presentation" className="px-3 pt-2 pb-1 text-xs text-muted-foreground">
                  {c.group}
                </p>
              )}
              <div
                id={optionId(i)}
                role="option"
                aria-selected={i === current}
                tabIndex={-1}
                onMouseMove={() => setActive(i)}
                onClick={() => choose(c)}
                className={cn(
                  'flex min-h-9 cursor-pointer items-center justify-between gap-3 rounded-md px-3 text-sm',
                  i === current && 'bg-accent text-accent-foreground',
                )}
              >
                <span className="truncate">{c.label}</span>
                {c.hint && (
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">{c.hint}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
