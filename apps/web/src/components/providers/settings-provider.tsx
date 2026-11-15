'use client';

import { formatPercent, formatQuantity, type MoneyOptions } from '@kosh/core';
import { DEFAULT_SETTINGS, type Settings } from '@kosh/contracts';
import { createContext, type ReactNode, useContext, useMemo } from 'react';
import { displayMoney, MASK } from '@/lib/display-money';
import { useBook, useSettings } from '@/lib/hooks';
import { setViewPrefs, useViewPrefs, type ViewPrefs } from '@/lib/view-prefs';

type MoneyFormat = Omit<MoneyOptions, 'style'> & {
  /** Format the real amount even in privacy mode (for logic such as a value's direction). */
  unmasked?: boolean;
};

interface Formatters {
  settings: Settings;
  ready: boolean;
  /** This device's view: privacy mode and display currency. */
  view: ViewPrefs;
  setView: (patch: Partial<ViewPrefs>) => void;
  /** Rupees per dollar used by the dollar view (the book's reference rate), when known. */
  usdInr: { rate: string; asOf: string } | null;
  money: (v: number | string, o?: MoneyFormat) => string;
  percent: (v: number, o?: { signed?: boolean; decimals?: number }) => string;
  qty: (v: number | string) => string;
}

const SettingsContext = createContext<Formatters | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const s = useSettings();
  const book = useBook();
  const view = useViewPrefs();
  const fx = book.status === 'ready' ? (book.data?.fx ?? null) : null;
  const rate = fx?.rate ?? null;
  const fxAsOf = fx?.asOf ?? null;

  const value = useMemo<Formatters>(() => {
    const settings = s.status === 'ready' ? s.data : DEFAULT_SETTINGS;
    const style = settings.numberFormat;
    return {
      settings,
      ready: s.status === 'ready',
      view,
      setView: setViewPrefs,
      usdInr: rate && fxAsOf ? { rate, asOf: fxAsOf } : null,
      money: (v, { unmasked, ...o } = {}) =>
        displayMoney(v, o, unmasked ? { ...view, hidden: false } : view, rate, style),
      percent: (v, o) => formatPercent(v, o),
      // Quantities reveal the size of a holding as much as its value does.
      qty: (v) => (view.hidden ? MASK : formatQuantity(v, style)),
    };
  }, [s, view, rate, fxAsOf]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

/** Number formatters that follow the user's settings and this device's view. */
export function useFormat(): Formatters {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useFormat must be used inside <SettingsProvider>');
  return ctx;
}
