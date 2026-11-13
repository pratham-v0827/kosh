'use client';

import {
  GoogleAuthProvider,
  sendSignInLinkToEmail,
  signInWithPopup,
  signInWithRedirect,
} from 'firebase/auth';
import { MailCheck } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, Suspense, useEffect, useState } from 'react';
import { Logo } from '@/components/logo';
import { useAuth } from '@/components/providers/auth-provider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { EMAIL_KEY, safeNext } from '@/lib/auth-links';
import { clientAuth } from '@/lib/firebase/client';

function SignInForm() {
  const { user, loading, error: authError } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get('next'));
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState<'google' | 'email' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && user) router.replace(next);
  }, [loading, user, router, next]);

  async function google() {
    setError(null);
    setBusy('google');
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(clientAuth(), provider);
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (
        code === 'auth/popup-blocked' ||
        code === 'auth/operation-not-supported-in-this-environment'
      ) {
        await signInWithRedirect(clientAuth(), provider);
        return;
      }
      if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') {
        setError('Google sign-in failed. Please try again.');
      }
    } finally {
      setBusy(null);
    }
  }

  async function emailLink(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy('email');
    try {
      await sendSignInLinkToEmail(clientAuth(), email, {
        url: `${window.location.origin}/sign-in/finish?next=${encodeURIComponent(next)}`,
        handleCodeInApp: true,
      });
      window.localStorage.setItem(EMAIL_KEY, email);
      setSent(true);
    } catch {
      setError('We could not send the link. Check the email address and try again.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>
          <h1 className="text-2xl font-semibold">Sign in to Kosh</h1>
        </CardTitle>
        <CardDescription>New here? Signing in creates your account.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {sent ? (
          <div
            role="status"
            className="flex gap-3 rounded-lg bg-accent p-4 text-sm text-accent-foreground"
          >
            <MailCheck aria-hidden className="size-5 shrink-0" />
            <p>
              Check <strong>{email}</strong> for a sign-in link. Open it on this device. You can
              close this tab.
            </p>
          </div>
        ) : (
          <>
            <Button className="w-full" onClick={google} disabled={busy !== null}>
              {busy === 'google' ? 'Opening Google…' : 'Continue with Google'}
            </Button>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <Separator className="flex-1" /> or <Separator className="flex-1" />
            </div>
            <form onSubmit={emailLink} className="space-y-3" noValidate>
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </div>
              <Button
                type="submit"
                variant="outline"
                className="w-full"
                disabled={busy !== null || !email.includes('@')}
              >
                {busy === 'email' ? 'Sending…' : 'Email me a sign-in link'}
              </Button>
            </form>
          </>
        )}
        {(error ?? authError) && (
          <p role="alert" className="text-sm text-destructive">
            {error ?? authError}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          No passwords. Kosh never asks for your broker login. By continuing you agree to the{' '}
          <Link className="underline underline-offset-2" href="/terms">
            Terms
          </Link>{' '}
          and{' '}
          <Link className="underline underline-offset-2" href="/privacy">
            Privacy notice
          </Link>
          .
        </p>
      </CardContent>
    </Card>
  );
}

export default function SignInPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 px-4 py-12">
      <Logo />
      <Suspense fallback={<div className="h-96 w-full max-w-sm" />}>
        <SignInForm />
      </Suspense>
    </main>
  );
}
