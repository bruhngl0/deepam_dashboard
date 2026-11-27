import { headers } from 'next/headers';

/*
 * The public Deepam Partner site, kept apart from the internal apps. PARTNER_SITE_URL (e.g. https://partners.deepam.com)
 * names its own address: there, every path is a partner page (/ = the application, /rules, /DPR-00012,
 * /dashboard/<token>) and nothing of the CRM, its APIs or its header can be reached (src/proxy.ts). On the CRM's
 * own address the same pages stay at /deepampartner/... as before.
 */

/** Set by the proxy on requests that came in on the partner site; the browser's copy is always dropped. */
export const PARTNER_SITE_HEADER = 'x-deepam-partner-site';

export function partnerSiteUrl(): string | null {
  const raw = process.env.PARTNER_SITE_URL?.trim().replace(/\/+$/, '');
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' || u.hostname === 'localhost' ? u.origin : null;
  } catch {
    return null;
  }
}

/** Whether `host` (Host / X-Forwarded-Host, without port for localhost tests too) is the partner site. */
export function isPartnerHost(host: string | null | undefined): boolean {
  const site = partnerSiteUrl();
  if (!site || !host) return false;
  const want = new URL(site).host.toLowerCase();
  return host.split(',')[0].trim().toLowerCase() === want;
}

/** A partner page's path for links on the page being rendered: short on the partner site, /deepampartner/... here. */
export async function partnerPath(path = '/'): Promise<string> {
  const onSite = (await headers()).get(PARTNER_SITE_HEADER) === '1';
  const p = path.startsWith('/') ? path : `/${path}`;
  return onSite ? p : `/deepampartner${p === '/' ? '' : p}`;
}

export async function onPartnerSite(): Promise<boolean> {
  return (await headers()).get(PARTNER_SITE_HEADER) === '1';
}
