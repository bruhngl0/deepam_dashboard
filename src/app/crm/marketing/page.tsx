import { requireUser } from '@/lib/auth';
import { MarketingWorkspace } from '@/components/marketing-workspace';

export default async function MarketingPage() {
  const userId = await requireUser();
  return <MarketingWorkspace key={userId} userId={userId} />;
}
