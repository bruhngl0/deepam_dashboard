import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { makeLead, nowLocal, type Dataset } from './local';
import { SalespersonMarketingWorkspace } from '@/components/salesperson-marketing-workspace';

const minutesAgo = (n: number) => new Date(Date.now() - n * 60000).toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' }).replace(' ', 'T');
const lead = makeLead({ phone: '+919000123410', name: 'Kritika Shanth', source: 'Meta ads', campaignId: 'Meta | 0010 | 2026 | 10 | Shubh Convention Centre (Blr) | Lead Gen', acquiredAt: minutesAgo(12), preferredStore: 'MG' });
Object.assign(lead, { claimedBy: 'Abhishek Thapa', claimGroup: 'shubh-convention', visitDay: 'Sunday, 18 October', visitSlot: '10:30 am – 12:30 pm' });
const data: Dataset = { version: 2, demo: false, leads: [lead], sales: [] };

vi.mock('@/components/marketing-shared', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/marketing-shared')>();
  return { ...actual, useMarketing: () => ({ data, save: () => true, message: '', setMessage: () => {}, refresh: async () => {} }) };
});

describe('salesperson queue card', () => {
  it('shows the campaign name, how long ago and the visit the lead asked for, without a date', () => {
    const html = renderToStaticMarkup(createElement(SalespersonMarketingWorkspace, { salespersonName: 'Abhishek Thapa', logoutAction: async () => {} }));
    const card = html.match(/<article[\s\S]*?<\/article>/)?.[0] ?? '';
    expect(card).toContain('Meta ads · Shubh Convention Centre (Blr) Lead Gen · 12 min ago · MG');
    expect(card).toContain('Visit: Sunday, 18 October · 10:30 am – 12:30 pm');
    expect(card).not.toContain(nowLocal().slice(0, 4));
  });
  it('labels a Virtual calls slot as the call time', () => {
    Object.assign(lead, { claimGroup: 'virtual-calls', visitDay: undefined, visitSlot: '11 am – 1 pm' });
    const html = renderToStaticMarkup(createElement(SalespersonMarketingWorkspace, { salespersonName: 'Abhishek Thapa', logoutAction: async () => {} }));
    expect(html).toContain('Call: 11 am – 1 pm');
    expect(html).not.toContain('Visit:');
  });
});
