'use client';

import {
  getRedirectResult,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type User,
} from 'firebase/auth';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { clientAuth } from '@/lib/firebase/client';

/** M0 proof that the browser talks to the Auth emulator. Replaced by real onboarding in M1. */
export function AuthDemo() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const auth = clientAuth();
    // Completes a pending redirect sign-in and surfaces its errors (no-op otherwise).
    getRedirectResult(auth).catch((e: unknown) =>
      setError(e instanceof Error ? e.message : String(e)),
    );
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setReady(true);
    });
  }, []);

  if (!ready) return <p className="text-sm text-muted-foreground">Checking session…</p>;

  return (
    <div className="flex flex-col gap-3">
      {user ? (
        <>
          <p className="text-sm">
            Signed in as <span className="font-mono text-xs">{user.uid.slice(0, 10)}…</span>
          </p>
          <Button variant="outline" onClick={() => signOut(clientAuth())}>
            Sign out
          </Button>
        </>
      ) : (
        <>
          <Button
            onClick={async () => {
              setError(null);
              try {
                await signInWithPopup(clientAuth(), new GoogleAuthProvider());
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              }
            }}
          >
            Sign in with Google (emulator)
          </Button>
          {/* Redirect works where popups are blocked (many mobile browsers, embedded webviews). */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => signInWithRedirect(clientAuth(), new GoogleAuthProvider())}
          >
            Popup blocked? Sign in with redirect
          </Button>
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
