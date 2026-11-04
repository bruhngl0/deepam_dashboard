import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { demoData } from './local';
import { MarketingWorkspace } from '@/components/marketing-workspace';
import { MarketingProfile } from '@/components/marketing-profile';
import { MarketingImport } from '@/components/marketing-import';
import { MarketingTeamWorkspace } from '@/components/marketing-team-workspace';
import { MarketingConverted } from '@/components/marketing-converted';
vi.mock('@/components/marketing-shared', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/marketing-shared')>();
  return { ...actual, useMarketing: () => ({ data: demoData(), save: () => true, message: '', setMessage: () => {}, refresh: async () => {} }) };
});
describe('marketing page rendering', () => {
  it('renders dashboard metrics and navigation with demo data', () => {
    const html = renderToStaticMarkup(createElement(MarketingWorkspace));
    for (const label of ['Marketing performance', 'Total marketing spend', 'Cost per lead', 'Converted leads', 'Sales generated', 'CAC', 'ROAS', 'Leads funnel', 'Calling and follow-up summary', 'New leads awaiting first call', 'Calls due today', 'Overdue follow-ups', 'Leads contacted today', 'Leads converted today', 'Date-Time From']) expect(html).toContain(label);
    // The header has only the four modules.
    const navigation = html.match(/<nav[^>]*aria-label="Marketing modules"[\s\S]*?<\/nav>/)?.[0] ?? '';
    expect([...navigation.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map(m => m[1])).toEqual(['Overview', 'Leads', 'Campaigns', 'Team performance']);
    expect(html).toContain('shared by every desk');
    expect(html).not.toContain('Clear local data');
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
