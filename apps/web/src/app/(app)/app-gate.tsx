'use client';

import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect } from 'react';
import { AppShell } from '@/components/app-shell';
import { useAuth } from '@/components/providers/auth-provider';
import { SettingsProvider } from '@/components/providers/settings-provider';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Signed-in area. This gate only decides what to render: data protection is enforced by
 * Firestore rules (reads) and by token verification on every API route (writes).
 */
export function AppGate({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) router.replace(`/sign-in?next=${encodeURIComponent(pathname)}`);
  }, [loading, user, router, pathname]);

  if (loading || !user) return <AppSkeleton />;

  return (
    <SettingsProvider>
      <AppShell>{children}</AppShell>
    </SettingsProvider>
  );
}

export function AppSkeleton() {
  return (
    <div
      className="mx-auto w-full max-w-6xl space-y-4 px-4 py-6"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">Loading your portfolio…</span>
      <Skeleton className="h-8 w-48" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}
