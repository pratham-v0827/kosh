'use client';

import { useSyncExternalStore } from 'react';

/**
 * How this device shows values: hidden (privacy mode) and in which currency. Remembered in this
 * browser only; a convenience, so every read and write tolerates blocked storage.
 */
export interface ViewPrefs {
  hidden: boolean;
  currency: 'INR' | 'USD';
}

export const DEFAULT_VIEW: ViewPrefs = { hidden: false, currency: 'INR' };
const KEY = 'kosh.view';

/** Stored text → preferences; anything unexpected falls back to the defaults. */
export function parseViewPrefs(raw: string | null): ViewPrefs {
  if (!raw) return DEFAULT_VIEW;
  try {
    const v = JSON.parse(raw) as Partial<Record<keyof ViewPrefs, unknown>>;
    return {
      hidden: v.hidden === true,
      currency: v.currency === 'USD' ? 'USD' : 'INR',
    };
  } catch {
    return DEFAULT_VIEW;
  }
}

const listeners = new Set<() => void>();
let cached: { raw: string | null; prefs: ViewPrefs } = { raw: null, prefs: DEFAULT_VIEW };
let memory: string | null = null; // used when storage is blocked

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return memory;
  }
}

function snapshot(): ViewPrefs {
  const raw = readRaw();
  if (raw !== cached.raw) cached = { raw, prefs: parseViewPrefs(raw) };
  return cached.prefs;
}

export function setViewPrefs(patch: Partial<ViewPrefs>) {
  const raw = JSON.stringify({ ...snapshot(), ...patch });
  memory = raw;
  try {
    window.localStorage.setItem(KEY, raw);
  } catch {
    // kept in memory for this tab
  }
  listeners.forEach((l) => l());
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) onChange(); // another tab changed it
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

export function useViewPrefs(): ViewPrefs {
  return useSyncExternalStore(subscribe, snapshot, () => DEFAULT_VIEW);
}
