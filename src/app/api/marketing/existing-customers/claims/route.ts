import { requireApiUser } from '@/lib/auth';
import { existingCustomerClaims } from '@/lib/marketing/existing-customer-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireApiUser();
  if (auth instanceof Response) return auth;
  return Response.json({ claims: await existingCustomerClaims() });
}
