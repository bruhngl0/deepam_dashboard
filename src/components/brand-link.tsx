'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** The header's brand: Hemparshwa OS, except on the calling desk, where it only leads back to the desk. */
export function BrandLink({ className, children }: { className: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const onDesk = pathname === '/sales' || pathname.startsWith('/sales/');
  return <Link href={onDesk ? '/sales/workspace' : 'https://os.hemparshwa.com/'} className={className}>{children}</Link>;
}
