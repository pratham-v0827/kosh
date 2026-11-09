import type { ReactNode } from 'react';
import { Suspense } from 'react';
import { AppGate, AppSkeleton } from './app-gate';

// Server layout: the client gate reads the URL (usePathname), so it must sit inside Suspense
// for routes with dynamic params to prerender under Cache Components.
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<AppSkeleton />}>
      <AppGate>{children}</AppGate>
    </Suspense>
  );
}
