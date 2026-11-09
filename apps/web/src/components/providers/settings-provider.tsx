'use client';

import { formatMoney, formatPercent, formatQuantity, type MoneyOptions } from '@kosh/core';
import { DEFAULT_SETTINGS, type Settings } from '@kosh/contracts';
import { createContext, type ReactNode, useContext, useMemo } from 'react';
import { useSettings } from '@/lib/hooks';

interface Formatters {
  settings: Settings;
  ready: boolean;
  money: (v: number | string, o?: Omit<MoneyOptions, 'style'>) => string;
  percent: (v: number, o?: { signed?: boolean; decimals?: number }) => string;
  qty: (v: number | string) => string;
}

const SettingsContext = createContext<Formatters | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const s = useSettings();
  const value = useMemo<Formatters>(() => {
    const settings = s.status === 'ready' ? s.data : DEFAULT_SETTINGS;
    const style = settings.numberFormat;
    return {
      settings,
      ready: s.status === 'ready',
      money: (v, o) => formatMoney(v, { ...o, style }),
      percent: (v, o) => formatPercent(v, o),
      qty: (v) => formatQuantity(v, style),
    };
  }, [s]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

/** Number formatters that follow the user's Indian / international preference. */
export function useFormat(): Formatters {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useFormat must be used inside <SettingsProvider>');
  return ctx;
}
