'use client';

import { usePathname } from 'next/navigation';

/** Drops the internal header on the customer-facing pages: the exhibition form and the Deepam Partner pages. */
export function SiteHeaderSlot({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isPublic = (base: string) => pathname === base || pathname.startsWith(`${base}/`);
  if (isPublic('/exhb') || isPublic('/deepampartner')) return null;
  return children;
}
