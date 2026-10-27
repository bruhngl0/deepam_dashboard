import { requireUser } from '@/lib/auth';
import { MarketingCampaign } from '@/components/marketing-campaign';

export default async function MarketingCampaignPage({ searchParams }: { searchParams: Promise<{ name?: string | string[] }> }) {
  await requireUser();
  const { name } = await searchParams;
  const campaign = (Array.isArray(name) ? name[0] : name)?.trim() ?? '';
  return <MarketingCampaign key={campaign} campaign={campaign} />;
}
