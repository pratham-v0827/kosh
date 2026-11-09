'use client';

import {
  getRedirectResult,
  onAuthStateChanged,
  signOut as fbSignOut,
  type User,
} from 'firebase/auth';
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { clientAuth } from '@/lib/firebase/client';

interface AuthState {
  user: User | null;
  /** True until the first auth state (and the session call for a signed-in user) has resolved. */
  loading: boolean;
  /** Error from finishing a redirect sign-in or from the session call. */
  error: string | null;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const auth = clientAuth();
    getRedirectResult(auth).catch((e: unknown) => setError(message(e)));
    return onAuthStateChanged(auth, async (u) => {
      if (u) {
        // Create the account / record activity once per browser session.
        const flag = `kosh.session.${u.uid}`;
        try {
          if (!sessionStorage.getItem(flag)) {
            await api('/api/v1/session', { method: 'POST' });
            sessionStorage.setItem(flag, '1');
          }
        } catch (e) {
          setError(message(e));
        }
      }
      setUser(u);
      setLoading(false);
    });
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      error,
      signOut: async () => {
        if (user) sessionStorage.removeItem(`kosh.session.${user.uid}`);
        await fbSignOut(clientAuth());
      },
    }),
    [user, loading, error],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

function message(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}
