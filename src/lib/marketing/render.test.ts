import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { demoData } from './local';
import { MarketingWorkspace } from '@/components/marketing-workspace';
import { MarketingProfile } from '@/components/marketing-profile';
import { MarketingImport } from '@/components/marketing-import';
import { MarketingTeamWorkspace } from '@/components/marketing-team-workspace';
import { MarketingConverted } from '@/components/marketing-converted';
import { NavTabs } from '@/components/nav-tabs';
const navigation = vi.hoisted(() => ({ pathname: '/marketing', search: '' }));
vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.search),
  useRouter: () => ({ push: () => {}, replace: () => {}, prefetch: () => {} }),
}));
vi.mock('@/components/marketing-shared', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/marketing-shared')>();
  return { ...actual, useMarketing: () => ({ data: demoData(), save: () => true, message: '', setMessage: () => {}, refresh: async () => {} }) };
});
describe('marketing page rendering', () => {
  it('renders dashboard metrics and navigation with demo data', () => {
    const html = renderToStaticMarkup(createElement(MarketingWorkspace));
    for (const label of ['Marketing performance', 'Total marketing spend', 'Cost per lead', 'Converted leads', 'Sales generated', 'CAC', 'ROAS', 'Leads funnel', 'Calling and follow-up summary', 'New leads awaiting first call', 'Calls due today', 'Overdue follow-ups', 'Leads contacted today', 'Leads converted today', 'Date-Time From']) expect(html).toContain(label);
    // The four sections are tabs in the site header now, not buttons on the page.
    expect(html).not.toContain('aria-label="Marketing modules"');
    expect(html).toContain('shared by every desk');
    expect(html).not.toContain('Clear local data');
  });
  it('puts the four sections in the site header, with the one in the URL lit', () => {
    const links = (search: string, pathname = '/marketing') => {
      Object.assign(navigation, { pathname, search });
      const html = renderToStaticMarkup(createElement(NavTabs));
      return [...html.matchAll(/<a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/g)].map(m => ({ href: m[1].replace(/&amp;/g, '&'), label: m[2], current: m[0].includes('aria-current="page"') }));
    };
    expect(links('').map(l => [l.label, l.href])).toEqual([['Overview', '/marketing'], ['Leads', '/marketing?module=leads'], ['Campaigns', '/marketing?module=campaigns'], ['Team performance', '/marketing?module=team']]);
    expect(links('').find(l => l.current)?.label).toBe('Overview');
    expect(links('module=team').find(l => l.current)?.label).toBe('Team performance');
    expect(links('', '/marketing/campaign').find(l => l.current)?.label).toBe('Campaigns');
    expect(links('', '/marketing-team')).toEqual([]);
    Object.assign(navigation, { pathname: '/marketing', search: '' });
  });
  it('renders converted customer KPIs, sources and profile links', () => {
    const data = demoData();
    const html = renderToStaticMarkup(createElement(MarketingConverted, { data, leads: data.leads, search: '', page: 0, onSearch: () => {}, onPage: () => {} }));
    for (const label of ['Converted customer profiles', 'Conversion rate', 'Total sales', 'Average bill value', 'Repeat customers', 'Top source', 'Source / campaign', 'View profile']) expect(html).toContain(label);
    expect(html).toContain('/marketing/leads/LD-DEMO-0001');
  });
  it('renders customer acquisition, action links and purchase timeline', () => {
    const html = renderToStaticMarkup(createElement(MarketingProfile, { leadId: 'LD-DEMO-0001' }));
    for (const label of ['Acquisition history', 'Interaction timeline', 'Lifetime sales', 'DEMO-1', 'DEMO-5', 'tel:+919000123410', 'wa.me/919000123410', 'mailto:']) expect(html).toContain(label);
  });
  it('renders both local import entry points and supported source guidance', () => {
    const html = renderToStaticMarkup(createElement(MarketingImport, { data: demoData(), save: () => true }));
    for (const label of ['Live Google Sheets', 'Import leads', 'Import sales', 'Instagram DM', 'Influencer', 'Sources:']) expect(html).toContain(label);
  });
  it('renders the marketing team dashboard and per-source navigation', () => {
    const html = renderToStaticMarkup(createElement(MarketingTeamWorkspace));
    for (const label of ['Marketing team', 'Total leads', 'Converted', 'Conversion rate', 'Leads who bought, by campaign', 'Every campaign', 'Sync from Deepam CRM', 'All source dashboards', 'Google ads', 'Meta ads']) expect(html).toContain(label);
    expect(html).not.toContain('revenue');
    for (const removed of ['Claimed leads', '>Contacted<', '>Interested<']) expect(html).not.toContain(removed);
  });
});
