import { headers } from 'next/headers';

/**
 * Where partner links point. `PARTNER_LINK_BASE` (for example https://deepam.com/deepampartner) wins once that address
 * serves or forwards to this app's /deepampartner pages; until then the links use the address this app was opened on.
 */
export async function partnerLinkBase(): Promise<string> {
  const configured = process.env.PARTNER_LINK_BASE?.trim().replace(/\/+$/, '');
  if (configured) return configured;
  return `${await appOrigin()}/deepampartner`;
}

/** The dashboard link stays on this app: it is private and must not depend on another site forwarding it. */
export async function partnerDashboardBase(): Promise<string> {
  return `${await appOrigin()}/deepampartner/dashboard`;
}

export async function appOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https');
  return `${proto.split(',')[0].trim()}://${host.split(',')[0].trim()}`;
}
