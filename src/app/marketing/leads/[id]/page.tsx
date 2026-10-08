import { requireUser } from '@/lib/auth';
import { MarketingProfile } from '@/components/marketing-profile';
export default async function MarketingLeadPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  return <MarketingProfile key={id} leadId={id} />;
}
