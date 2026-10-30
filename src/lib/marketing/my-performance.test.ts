import { describe, expect, it } from 'vitest';
import { callLog, EMPTY, makeLead, salespersonPerformance, type CallEntry, type Dataset, type ExistingClaim } from './local';
import { performanceFor } from './my-performance';

// Srinivas G has one campaign lead (a call stored on the lead) and one claimed existing customer (a call only in the
// shared call records). Each has a bill after its claim; the existing customer also has one before it.
const base = makeLead({ name: 'Lead', phone: '+919000000010', source: 'Meta', acquiredAt: '2026-09-25T10:00:00' });
const lead = {
  ...base, claimedBy: 'Srinivas G', claimedAt: '2026-10-01T09:00:00', status: 'Connected / interested',
  interactions: [...base.interactions, { id: 'on-lead', type: 'call', at: '2026-10-02T10:00:00', by: 'Srinivas G', outcome: 'Connected / interested', text: 'Called' }],
} as Dataset['leads'][number];
const data: Dataset = { ...EMPTY, leads: [lead], sales: [
  { phone: '+919000000010', invoice: 'LEAD-AFTER', amount: 700, date: '2026-10-05T12:00:00', store: 'MG' },
  { phone: '+919000000020', invoice: 'EXISTING-BEFORE', amount: 900, date: '2026-10-01T12:00:00', store: 'MG' },
  { phone: '+919000000020', invoice: 'EXISTING-AFTER', amount: 500, date: '2026-10-20T12:00:00', store: 'MG' },
] };
const claims: ExistingClaim[] = [{ leadId: 'existing-customer:1', salesperson: 'srinivas g', phone: '+919000000020', claimedAt: '2026-10-10T09:00:00' }];
const stored: CallEntry[] = [
  { id: 'shared', at: '2026-10-11T10:00:00', salesperson: 'Srinivas G', outcome: 'No answer', note: '', leadId: 'existing-customer:1', name: 'Existing', phone: '+919000000020' },
];

/** What Team performance (marketing-salespeople.tsx) shows for this person: everyone's numbers, then this row. */
function teamRow(from: string, to: string) {
  const all = callLog([data], stored);
  const calls = all.filter(call => (!from || call.at.slice(0, 10) >= from) && (!to || call.at.slice(0, 10) <= to));
  return salespersonPerformance(data, calls, ['Someone Else', 'Srinivas G'], claims, { from, to, allCalls: all })[1];
}

describe('My performance', () => {
  it('counts the claimed existing customer and the shared call record', () => {
    expect(performanceFor(data, 'Srinivas G', '', '', stored, claims)).toMatchObject({ claimed: 2, called: 2, pending: 0, converted: 2, revenue: 1200 });
  });

  it('only counts the period when dates are set', () => {
    expect(performanceFor(data, 'Srinivas G', '2026-10-10', '2026-10-31', stored, claims)).toMatchObject({ called: 1, converted: 1, revenue: 500 });
  });

  it.each([['', ''], ['2026-10-10', '2026-10-31'], ['2026-10-01', '2026-10-05']])('matches Team performance (from %s to %s)', (from, to) => {
    expect(performanceFor(data, 'Srinivas G', from, to, stored, claims)).toEqual(teamRow(from, to));
  });
});
