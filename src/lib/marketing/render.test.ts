import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { demoData } from './local';
import { MarketingWorkspace } from '@/components/marketing-workspace';
import { MarketingProfile } from '@/components/marketing-profile';
import { MarketingImport } from '@/components/marketing-import';
vi.mock('@/components/marketing-shared', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/marketing-shared')>();
  return { ...actual, useMarketing: () => ({ data: demoData(), save: () => true, message: '', setMessage: () => {}, refresh: async () => {} }) };
});
describe('marketing page rendering', () => {
  it('renders dashboard metrics and navigation with demo data', () => {
    const html = renderToStaticMarkup(createElement(MarketingWorkspace));
    for (const label of ['Calling queue', 'Follow-ups', 'Cost per acquisition', 'Converted customers', 'Store visits', 'Insights', 'Date-Time From']) expect(html).toContain(label);
    expect(html).toContain('shared by every desk');
    expect(html).not.toContain('Clear local data');
  });
  it('renders customer acquisition, action links and purchase timeline', () => {
    const html = renderToStaticMarkup(createElement(MarketingProfile, { leadId: 'LD-DEMO-0001' }));
    for (const label of ['Acquisition history', 'Interaction timeline', 'Lifetime sales', 'DEMO-1', 'DEMO-5', 'tel:+919000123410', 'wa.me/919000123410', 'mailto:']) expect(html).toContain(label);
  });
  it('renders both local import entry points and supported source guidance', () => {
    const html = renderToStaticMarkup(createElement(MarketingImport, { data: demoData(), save: () => true }));
    for (const label of ['Live Google Sheets', 'Import leads', 'Import sales', 'Instagram DM', 'Influencer', 'Sources:']) expect(html).toContain(label);
  });
});
