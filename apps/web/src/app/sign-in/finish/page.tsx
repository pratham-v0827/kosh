'use client';

import { isSignInWithEmailLink, signInWithEmailLink } from 'firebase/auth';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EMAIL_KEY, safeNext } from '@/lib/auth-links';
import { clientAuth } from '@/lib/firebase/client';

function Finish() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get('next'));
  const [needEmail, setNeedEmail] = useState(false);
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  const complete = useCallback(
    async (address: string) => {
      try {
        await signInWithEmailLink(clientAuth(), address, window.location.href);
        window.localStorage.removeItem(EMAIL_KEY);
        router.replace(next);
      } catch {
        setError('This sign-in link is invalid or has expired. Request a new one.');
      }
    },
    [next, router],
  );

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // Runs after mount (needs window); state updates happen asynchronously, not during the effect.
    void Promise.resolve().then(() => {
      if (!isSignInWithEmailLink(clientAuth(), window.location.href)) {
        setError('This page needs a sign-in link from your email.');
        return;
      }
      const saved = window.localStorage.getItem(EMAIL_KEY);
      if (saved) void complete(saved);
      else setNeedEmail(true); // opened on a different device/browser
    });
  }, [complete]);

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>
          <h1>Finishing sign-in…</h1>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {needEmail && !error && (
          <form
            className="space-y-3"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              void complete(email);
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="confirm-email">Confirm your email</Label>
              <Input
                id="confirm-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full">
              Continue
            </Button>
          </form>
        )}
        {error && (
          <div className="space-y-3">
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
            <Button asChild variant="outline" className="w-full">
              <Link href="/sign-in">Back to sign in</Link>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function FinishPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 px-4 py-12">
      <Logo />
      <Suspense fallback={null}>
        <Finish />
      </Suspense>
    </main>
  );
}
