import { requireUser } from '@/lib/auth';
import { MarketingTeamWorkspace } from '@/components/marketing-team-workspace';

export default async function MarketingTeamPage() {
  await requireUser();
  return <MarketingTeamWorkspace />;
}
