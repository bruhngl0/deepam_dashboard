/**
 * Marketing Intelligence's four sections. They are tabs in the site header (nav-tabs.tsx) and the page
 * shows the one named in the URL: /marketing, /marketing?module=leads, …campaigns, …team.
 */
export const MARKETING_MODULES = [
  { label: 'Overview', slug: '' },
  { label: 'Leads', slug: 'leads' },
  { label: 'Campaigns', slug: 'campaigns' },
  { label: 'Team performance', slug: 'team' },
] as const;

export type MarketingModule = (typeof MARKETING_MODULES)[number]['label'];

/** The section a `module` query value names; Overview when it names none. */
export function marketingModuleFrom(slug: string | null | undefined): MarketingModule {
  return MARKETING_MODULES.find(m => m.slug && m.slug === slug)?.label ?? 'Overview';
}

export function marketingModuleHref(module: MarketingModule): string {
  const slug = MARKETING_MODULES.find(m => m.label === module)?.slug;
  return slug ? `/marketing?module=${slug}` : '/marketing';
}

/** The section a Marketing page belongs to: a lead's page to Leads, a campaign report to Campaigns. */
export function marketingModuleOf(pathname: string, slug: string | null): MarketingModule {
  if (pathname.startsWith('/marketing/leads')) return 'Leads';
  if (pathname.startsWith('/marketing/campaign')) return 'Campaigns';
  return marketingModuleFrom(slug);
}
