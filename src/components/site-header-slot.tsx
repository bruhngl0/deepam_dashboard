'use client';

import { usePathname } from 'next/navigation';

/** Drops the internal header on the customer-facing exhibition pages. */
export function SiteHeaderSlot({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === '/exhb' || pathname.startsWith('/exhb/')) return null;
  return children;
}
