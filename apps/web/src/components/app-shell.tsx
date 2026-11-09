'use client';

import { History, LayoutDashboard, List, LogOut, Plus, Settings } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { Logo } from '@/components/logo';
import { RefreshControl } from '@/components/refresh-control';
import { useAuth } from '@/components/providers/auth-provider';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/holdings', label: 'Holdings', icon: List },
  { href: '/history', label: 'History', icon: History },
  { href: '/manual/new', label: 'Add holding', icon: Plus },
  { href: '/settings', label: 'Settings', icon: Settings },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-6 px-4">
          <Logo href="/dashboard" size={28} />
          <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
            {NAV.filter((n) => n.href !== '/settings').map((n) => (
              <Link
                key={n.href}
                href={n.href}
                aria-current={isActive(n.href) ? 'page' : undefined}
                className={cn(
                  'rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground',
                  isActive(n.href) && 'bg-accent text-accent-foreground',
                )}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <RefreshControl compact />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" aria-label="Account menu" className="gap-2">
                  <span
                    aria-hidden
                    className="grid size-7 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
                  >
                    {(user?.displayName ?? user?.email ?? '?').slice(0, 1).toUpperCase()}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="truncate font-normal text-muted-foreground">
                  {user?.email ?? 'Signed in'}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => router.push('/history')}>
                  <History aria-hidden /> Refresh history
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => router.push('/settings')}>
                  <Settings aria-hidden /> Settings
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={async () => {
                    await signOut();
                    router.replace('/sign-in');
                  }}
                >
                  <LogOut aria-hidden /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 pt-6 pb-24 md:pb-10">
        {children}
      </main>

      <footer className="mx-auto hidden w-full max-w-6xl px-4 pb-6 text-xs text-muted-foreground md:block">
        Not investment advice. Not affiliated with any broker, registrar or exchange.
      </footer>

      {/* Mobile bottom navigation (≤ md). Targets are ≥ 44px tall. */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t bg-background pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {NAV.filter((n) => n.href !== '/history').map((n) => (
          <Link
            key={n.href}
            href={n.href}
            aria-current={isActive(n.href) ? 'page' : undefined}
            className={cn(
              'flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-muted-foreground',
              isActive(n.href) && 'text-primary',
            )}
          >
            <n.icon aria-hidden className="size-5" />
            {n.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
