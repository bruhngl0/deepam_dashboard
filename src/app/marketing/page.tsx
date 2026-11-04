import { Suspense } from 'react';
import { requireUser } from '@/lib/auth';
import { MarketingWorkspace } from '@/components/marketing-workspace';

export default async function MarketingPage() {
  await requireUser();
  // The workspace reads its section from the URL (useSearchParams), which needs a Suspense boundary.
  return <Suspense fallback={<p role="status" className="p-8 text-ink-2">Loading marketing workspace…</p>}><MarketingWorkspace /></Suspense>;
}
