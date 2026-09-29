import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { commitPreview, convertedLeads, EMPTY, guessMapping, makeLead, metrics, parseDateTime, previewRows, readDataset, recordCall, safeProductLink, type Outcome } from './local';
const row = { Name: 'Asha', Number: '9000123410', Email: 'asha@example.com', City: 'Bengaluru', Source: 'Meta ads', 'Campaign ID': 'CAM-1', 'Preferred Store': 'MG', 'Date and time': '2026-09-20 10:30', 'Cost per lead': 100 };
const mapping = guessMapping(Object.keys(row));
const input = { outcome: 'Connected / interested' as Outcome, note: 'Wedding shopping', intent: 'Wedding saree', store: 'MG', product: '', category: '', productLink: '', due: '', salesperson: 'Abishek' };
const lead = () => makeLead({ phone: '+919000123410', name: 'Asha', source: 'Meta ads', acquiredAt: '2026-09-20T10:30:00', cost: 100 });

describe('marketing identity and acquisition', () => {
  it('keeps the generated identity and call history when reimporting another source', () => {
    const first = commitPreview(EMPTY, previewRows([row], 'leads', mapping, EMPTY));
    first.leads[0] = recordCall(first.leads[0], input, '2026-09-21T12:00:00');
    const next = previewRows([{ ...row, Number: '+91 90001 23410', Source: 'WhatsApp', 'Campaign ID': 'CAM-2' }], 'leads', mapping, first);
    expect(next.updated).toBe(1);
    const saved = commitPreview(first, next);
    expect(saved.leads).toHaveLength(1);
    expect(saved.leads[0].id).toBe(first.leads[0].id);
    expect(saved.leads[0].status).toBe('Connected / interested');
    expect(saved.leads[0].acquisitions.map(a => a.source)).toEqual(['Meta ads', 'WhatsApp']);
    expect(saved.leads[0].interactions.some(i => i.type === 'call')).toBe(true);
    const repeated = previewRows([{ ...row, Source: 'WhatsApp', 'Campaign ID': 'CAM-2' }], 'leads', mapping, saved);
    expect(repeated.leads).toHaveLength(0);
    expect(repeated.duplicates).toBe(1);
  });
  it('accepts multi-source rows without multiplying acquisition cost', () => {
    const result = previewRows([{ ...row, Source: 'Meta ads;WhatsApp;meta ads' }], 'leads', mapping, EMPTY);
    expect(result.leads[0].acquisitions).toHaveLength(2);
    expect(metrics(commitPreview(EMPTY, result)).spend).toBe(100);
  });
  it('rejects unsupported sources and invalid contact/cost values', () => {
    for (const change of [{ Source: 'Unknown network' }, { Email: 'broken' }, { 'Cost per lead': -5 }]) expect(previewRows([{ ...row, ...change }], 'leads', mapping, EMPTY).errors).toHaveLength(1);
  });
  it('retains real legacy records without inventing email, purchase dates or costs', () => {
    const migrated = readDataset(JSON.stringify({ version: 1, demo: false, leads: [{ name: 'Asha', phone: '+919000123410', source: 'Meta', date: '2026-09-20', preferredStore: 'MG', campaignId: 'CAM-1' }], sales: [{ phone: '+919000123410', invoice: 'I1', amount: 1000 }] }));
    expect(migrated.leads[0].email).toBe('');
    expect(migrated.leads[0].acquiredAt).toBe('2026-09-20');
    expect(migrated.leads[0].acquisitions[0].cost).toBeNull();
    expect(migrated.sales[0].date).toBe('');
    expect(readDataset(JSON.stringify(migrated))).toEqual(migrated);
  });
  it('round-trips a real Excel workbook with native date cells', () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ ...row, 'Date and time': new Date(2026, 8, 20, 10, 30) }]), 'Leads');
    const read = XLSX.read(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer', cellDates: true });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(read.Sheets.Leads);
    const result = previewRows(rows, 'leads', mapping, EMPTY);
    expect(result.errors).toEqual([]);
    expect(result.leads[0].acquiredAt).toBe('2026-09-20T10:30:00');
    expect(result.leads[0].email).toBe('asha@example.com');
  });
});
describe('calling and follow-up workflow', () => {
  it('requires intent and store for interested leads', () => {
    expect(() => recordCall(lead(), { ...input, salesperson: '' })).toThrow('logged');
    expect(() => recordCall(lead(), { ...input, intent: '' })).toThrow('intent');
    expect(() => recordCall(lead(), { ...input, store: '' })).toThrow('store');
  });
  it('requires product and category for online interest', () => {
    expect(() => recordCall(lead(), { ...input, store: 'Online' })).toThrow('product');
    const next = recordCall(lead(), { ...input, store: 'Online', product: 'Saree', category: 'Silk', productLink: '' });
    expect(next.product).toBe('Saree');
    expect(next.category).toBe('Silk');
    expect(safeProductLink('javascript:alert(1)')).toBe(false);
  });
  it('adds a current-time follow-up when requested and replaces previous pending follow-ups', () => {
    const original = lead();
    original.followups = [{ id: 'old', due: '2026-09-21T12:00', note: 'Call', completedAt: null }];
    const at = '2026-09-21T13:00:00';
    expect(() => recordCall(original, { ...input, outcome: 'Callback required', due: '2026-09-21T12:30' }, at)).toThrow('future');
    const next = recordCall(original, { ...input, outcome: 'Callback required', createFollowup: true }, at);
    expect(next.followups.filter(f => !f.completedAt)).toHaveLength(1);
    expect(next.followups[0].completedAt).toBe(at);
    expect(next.followups[1].due).toBe('2026-09-21T13:00');
    expect(next.interactions.at(-1)?.type).toBe('followup');
  });
  it('rejects invalid calendar or clock times and converts explicit offsets to IST', () => {
    expect(parseDateTime('2026-02-30 12:00')).toBeNull();
    expect(parseDateTime('2026-09-20 25:00')).toBeNull();
    expect(parseDateTime('2026-09-20T10:30:00Z')).toBe('2026-09-20T16:00:00');
    expect(parseDateTime('20/09/2026 10:30')).toBe('2026-09-20T10:30:00');
  });
});
describe('sales and master metrics', () => {
  it('links sales in either import order and avoids duplicate bills', () => {
    const saleRows = [{ Number: '9000123410', Invoice: 'B1', Amount: 2500, Date: '2026-09-21', Store: 'MG' }];
    const map = guessMapping(Object.keys(saleRows[0]));
    const salesFirst = commitPreview(EMPTY, previewRows(saleRows, 'sales', map, EMPTY));
    const data = commitPreview(salesFirst, previewRows([row], 'leads', mapping, salesFirst));
    expect(convertedLeads(data)).toHaveLength(1);
    expect(previewRows(saleRows, 'sales', map, data).duplicates).toBe(1);
    expect(previewRows([{ ...saleRows[0], Amount: 5000 }], 'sales', map, data).errors).toHaveLength(1);
    expect(metrics(data)).toMatchObject({ converted: 1, revenue: 2500, conversion: 100, cpa: 100 });
  });
  it('counts connected leads, unique visits and conversions once across repeated interactions', () => {
    const first = recordCall(lead(), input);
    first.interactions.push({ id: 'visit-1', type: 'visit', at: '2026-09-21', text: 'MG' }, { id: 'visit-2', type: 'visit', at: '2026-09-22', text: 'MG' });
    const second = makeLead({ phone: '+919000123411', name: 'Other', source: 'Referral', cost: null });
    const data = { ...EMPTY, leads: [first, second], sales: [{ phone: first.phone, invoice: '1', amount: 1000, date: '', store: '' }, { phone: first.phone, invoice: '2', amount: 2000, date: '', store: '' }, { phone: '+919000123499', invoice: '3', amount: 9999, date: '', store: '' }] };
    expect(metrics(data)).toMatchObject({ total: 2, contacted: 1, interested: 1, visits: 1, converted: 1, orders: 2, revenue: 3000, conversion: 50, cpa: 100, costsKnown: 1, costsTotal: 2 });
    expect(metrics(data, [second])).toMatchObject({ revenue: 0, converted: 0, cpa: null });
  });
});
