import Image from 'next/image';
import Link from 'next/link';
import { cn } from '@/lib/utils';

export function Logo({
  href = '/',
  size = 32,
  className,
}: {
  href?: string;
  size?: number;
  className?: string;
}) {
  return (
    <Link href={href} className={cn('inline-flex items-center gap-2 rounded-md', className)}>
      <Image src="/kosh-mark.svg" alt="" width={size} height={size} priority />
      <span className="text-xl font-semibold tracking-tight">kosh</span>
    </Link>
  );
}
