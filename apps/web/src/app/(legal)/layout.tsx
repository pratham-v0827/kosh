import type { ReactNode } from 'react';
import { Logo } from '@/components/logo';

export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8">
      <header>
        <Logo />
      </header>
      <main className="mt-8">
        <article className="space-y-4 text-sm leading-6 [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:mt-6 [&_h2]:text-base [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc">
          {children}
        </article>
      </main>
    </div>
  );
}
