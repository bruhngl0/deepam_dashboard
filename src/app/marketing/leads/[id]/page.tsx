import { requireUser } from '@/lib/auth';
import { MarketingProfile } from '@/components/marketing-profile';
export default async function MarketingLeadPage({ params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUser();
  const { id } = await params;
  return <MarketingProfile key={`${userId}:${id}`} userId={userId} leadId={id} />;
}
