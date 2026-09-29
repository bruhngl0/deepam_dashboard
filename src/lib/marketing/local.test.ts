import { describe, expect, it } from 'vitest';
import { convertedLeads, demoData, EMPTY, filterLeads, parseLeadDate, guessMapping, previewRows, readDataset } from './local';

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
