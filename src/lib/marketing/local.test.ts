import { describe, expect, it } from 'vitest';
import { campaignName, convertedLeads, demoData, EMPTY, filterLeads, hasLoggedCall, parseLeadDate, guessMapping, previewRows, readDataset, salespersonPerformance, type CallEntry } from './local';

const mapping = guessMapping(['Name', 'Number', 'Source', 'Invoice', 'Amount']);
describe('local marketing imports', () => {
  it('normalizes phones and merges multiple sources into one stable lead', () => {
    const result = previewRows([
      { Name: 'Asha', Number: '9000123410', Source: 'facebook' },
      { Name: 'Asha again', Number: '+91 90001 23410', Source: 'Google' },
    ], 'leads', mapping, EMPTY);
    expect(result.leads).toHaveLength(1);
    expect(result.leads[0]).toMatchObject({ name: 'Asha', phone: '+919000123410', source: 'Meta ads' });
    expect(result.leads[0].acquisitions.map(a => a.source)).toEqual(['Meta ads', 'Google ads']);
    expect(result.duplicates).toBe(0);
    expect(previewRows([{ Name: 'Updated', Number: '09000123410', Source: 'Google' }], 'leads', mapping, { ...EMPTY, leads: result.leads }).duplicates).toBe(1);
  });
  it('matches sales imported before leads and counts a repeat buyer once', () => {
    const sales = previewRows([
      { Number: '919000123410', Invoice: 'A', Amount: '₹2,500' },
      { Number: '9000123410', Invoice: 'B', Amount: 1000 },
      { Number: '9000123499', Invoice: 'C', Amount: '' },
    ], 'sales', mapping, EMPTY).sales;
    expect(convertedLeads({ ...EMPTY, sales })).toEqual([]);
    const leads = previewRows([{ Name: 'Asha', Number: '+91 90001 23410', Source: 'Meta' }], 'leads', mapping, EMPTY).leads;
    const converted = convertedLeads({ ...EMPTY, leads, sales });
    expect(converted).toHaveLength(1);
    expect(converted[0].sales.reduce((n, s) => n + (s.amount ?? 0), 0)).toBe(3500);
    expect(sales[2].amount).toBeNull();
    expect(previewRows([{ Number: '9000123410', Invoice: 'A', Amount: 2500 }], 'sales', mapping, { ...EMPTY, sales }).duplicates).toBe(1);
  });
  it('rejects ambiguous phones, missing fields and invalid amounts with row numbers', () => {
    const leads = previewRows([
      { Name: 'X', Number: '9999999999', Source: 'Meta' },
      { Name: '', Number: '9000123410', Source: 'Meta' },
      { Name: 'Y', Number: '9000123410/9000123411', Source: 'Meta' },
    ], 'leads', mapping, EMPTY);
    expect(leads.leads).toHaveLength(0);
    expect(leads.errors.map(e => e.row)).toEqual([2, 3, 4]);
    const sales = previewRows([
      { Number: '9000123410', Invoice: '', Amount: 10 },
      { Number: '9000123410', Invoice: 'A', Amount: -10 },
      { Number: '9000123410', Invoice: 'B', Amount: 'invalid' },
    ], 'sales', mapping, EMPTY);
    expect(sales.errors).toHaveLength(3);
    expect(sales.sales).toHaveLength(0);
  });
  it('seeds consistent demo records and round-trips local storage', () => {
    const demo = demoData();
    expect(convertedLeads(demo)).toHaveLength(4);
    expect(demo.leads).toHaveLength(12);
    expect(readDataset(JSON.stringify(demo))).toEqual(demo);
    expect(readDataset(JSON.stringify(EMPTY))).toEqual(EMPTY);
    expect(() => readDataset('{"version":2}')).toThrow();
  });
});

describe('campaign, store and date fields', () => {
  it('shows only the final segment of a structured campaign name', () => {
    expect(campaignName('Google | 0001 | 2026 | 09 | Storevisit')).toBe('Storevisit');
    expect(campaignName('Meta | 0010 | 2026 | 10 | Shubh Convention Centre (Blr) | Lead Gen')).toBe('Shubh Convention Centre (Blr)');
    expect(campaignName('Storevisit')).toBe('Storevisit');
    expect(campaignName('')).toBe('');
  });
  it('imports and normalizes the new fields and rejects invalid stores or dates', () => {
    const mapping = guessMapping(['Name', 'Number', 'Source', 'Campaign ID', 'Preferred Store', 'Date']);
    const row = { Name: 'Asha', Number: '9000123410', Source: 'Meta', 'Campaign ID': '00012', 'Preferred Store': 'Jayanagar', Date: '28/09/2026' };
    const result = previewRows([row], 'leads', mapping, EMPTY);
    expect(result.leads[0]).toMatchObject({ campaignId: '00012', preferredStore: 'JAYNAGAR', date: '2026-09-28' });
    expect(previewRows([{ ...row, Date: '31/09/2026' }], 'leads', mapping, EMPTY).errors).toHaveLength(1);
    expect(previewRows([{ ...row, 'Preferred Store': 'Other' }], 'leads', mapping, EMPTY).errors).toHaveLength(1);
    expect(parseLeadDate(new Date(2026, 8, 28))).toBe('2026-09-28');
    expect(parseLeadDate('2026-02-29')).toBeNull();
    expect(parseLeadDate('2024-02-29')).toBe('2024-02-29');
  });
  it('filters inclusive dates and stores together, excluding undated leads', () => {
    const leads = demoData().leads;
    const filters = { from: '2026-09-15', to: '2026-09-17', store: 'MG', source: '', search: '' };
    expect(filterLeads(leads, filters).map(l => l.date)).toEqual(['2026-09-15', '2026-09-17']);
    expect(filterLeads([{ ...leads[0], date: '' }], filters)).toEqual([]);
    expect(filterLeads(leads, { ...filters, from: '2026-09-18' })).toEqual([]);
    expect(filterLeads(leads, { ...filters, search: 'CAM-2026-003' })).toHaveLength(1);
  });
  it('migrates old local data without losing records or inventing real lead details', () => {
    const demo = demoData();
    const oldLeads = demo.leads.map(({ phone, name, source }) => ({ phone, name, source }));
    const migrated = readDataset(JSON.stringify({ ...demo, version: 1, leads: [...oldLeads, { phone: '+919000123498', name: 'Imported person', source: 'Google' }] }));
    expect(migrated.leads[0]).toMatchObject({ id: demo.leads[0].id, phone: demo.leads[0].phone, name: demo.leads[0].name });
    expect(migrated.leads[12]).toMatchObject({ campaignId: '', preferredStore: '', date: '' });
    expect(migrated.sales).toEqual(demo.sales);
  });
});

describe('salesperson performance', () => {
  it('identifies every lead with a logged call regardless of outcome', () => {
    const leads = demoData().leads;
    expect(hasLoggedCall(leads[0])).toBe(true);
    expect(hasLoggedCall(leads[7])).toBe(false);
  });

  it('aggregates claimed leads, call attempts, outcomes, conversions, and revenue', () => {
    const data = demoData();
    const lead = data.leads[0];
    lead.claimedBy = 'Abhishek Thapa';
    const calls: CallEntry[] = [
      { id: 'call-1', at: '2026-10-01T10:00:00', salesperson: 'Abhishek Thapa', outcome: 'No answer', note: '', leadId: lead.id, name: lead.name, phone: lead.phone },
      { id: 'call-2', at: '2026-10-02T10:00:00', salesperson: 'Abhishek Thapa', outcome: 'Connected / interested', note: '', leadId: lead.id, name: lead.name, phone: lead.phone },
    ];
    expect(salespersonPerformance(data, calls, ['Abhishek Thapa'])).toEqual([{
      salesperson: 'Abhishek Thapa', claimed: 1, called: 1, pending: 0, interested: 1, converted: 1, revenue: 4300,
    }]);
  });
});

describe('conversionsByCampaign', () => {
  it('counts converted leads per source and campaign, once per lead', async () => {
    const { conversionsByCampaign, makeLead } = await import('./local');
    const a = makeLead({ phone: '+919000000001', name: 'A', source: 'Meta ads', campaignId: 'Meta | 0001', acquiredAt: '2026-09-01T10:00:00' });
    a.acquisitions.push({ source: 'Google ads', campaignId: 'Google | 0001', at: '2026-09-02T10:00:00', cost: null });
    const b = makeLead({ phone: '+919000000002', name: 'B', source: 'Meta ads', campaignId: 'Meta | 0001', acquiredAt: '2026-09-01T10:00:00' });
    const c = makeLead({ phone: '+919000000003', name: 'C', source: 'Meta ads', acquiredAt: '2026-09-01T10:00:00' });
    const sale = (phone: string, invoice: string) => ({ phone, invoice, amount: 100, date: '2026-09-05T12:00:00', store: 'MG' });
    const rows = conversionsByCampaign({ version: 2, demo: false, leads: [a, b, c], sales: [sale(a.phone, 'X1'), sale(a.phone, 'X2')] });
    expect(rows).toEqual([
      { source: 'Meta ads', campaign: 'Meta | 0001', leads: 2, converted: 1, rate: 50 },
      { source: 'Google ads', campaign: 'Google | 0001', leads: 1, converted: 1, rate: 100 },
      { source: 'Meta ads', campaign: '', leads: 1, converted: 0, rate: 0 },
    ]);
  });
});

describe('salesperson card labels', () => {
  it('says how long ago, without a date', async () => {
    const { timeAgo } = await import('./local');
    expect(timeAgo('2026-10-10T16:48:00', '2026-10-10T17:00:00')).toBe('12 min ago');
    expect(timeAgo('2026-10-10T15:00:00', '2026-10-10T17:00:30')).toBe('2 hr ago');
    expect(timeAgo('2026-10-09T10:00:00', '2026-10-10T17:00:00')).toBe('1 day ago');
    expect(timeAgo('2026-10-01', '2026-10-10T17:00:00')).toBe('9 days ago');
    expect(timeAgo('2026-10-10T17:00:10', '2026-10-10T17:00:00')).toBe('just now');
    expect(timeAgo('2026-10-10T19:00', '2026-10-10T17:00:00')).toBe('in 2 hr');
  });
  it('tidies lead-form answers', async () => {
    const { formChoice } = await import('./local');
    expect(formChoice('friday,_16_october')).toBe('Friday, 16 October');
    expect(formChoice('2:30_pm_–_4:30_pm')).toBe('2:30 pm – 4:30 pm');
    expect(formChoice('11_Am_–_1_Pm')).toBe('11 am – 1 pm');
    expect(formChoice('')).toBe('');
  });
});
