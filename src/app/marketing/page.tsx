import { requireUser } from '@/lib/auth';
import { MarketingWorkspace } from '@/components/marketing-workspace';

export default async function MarketingPage() {
  await requireUser();
  return <MarketingWorkspace />;
}
