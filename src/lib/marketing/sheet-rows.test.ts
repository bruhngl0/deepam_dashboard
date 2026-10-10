import { describe, expect, it } from 'vitest';
import { commitPreview, EMPTY, previewRows, recordCall, type Outcome } from './local';
import { CANONICAL, canonicalRows, findHeaderRow, gridHeaders, gridToRows, guessLeadMapping, serialToDateTime, tabRows } from './sheet-rows';

// What the Sheets API returns with UNFORMATTED_VALUE: numbers stay numbers, dates are serials, trailing blanks are dropped.
const grid: unknown[][] = [
  ['Name', 'Number', 'Email', 'Source', 'Campaign ID', 'Preferred Store', 'Date and time', 'Cost per lead', 'Notes'],
  ['Asha', 9000123410, 'asha@example.com', 'Meta ads', 'CAM-1', 'MG', 46285.4375, 100],
  [],
  ['Meera', '+91 90001 23411', '', '', '', '', 46286],
  ['', '', '', '', '', '', '', '', 'a stray note'],
  ['Broken', '12345', '', 'Meta ads'],
];
const mapping = guessLeadMapping(gridHeaders(grid));
const sync = (cells: unknown[][], data = EMPTY, source = 'WhatsApp') => previewRows(canonicalRows(gridToRows(cells), mapping, source), 'leads', CANONICAL, data);

describe('google sheet rows', () => {
  it('guesses the same columns as a file import', () => {
    expect(mapping).toMatchObject({ phone: 'Number', name: 'Name', source: 'Source', campaignId: 'Campaign ID', preferredStore: 'Preferred Store', date: 'Date and time', cost: 'Cost per lead' });
  });
  it('converts date serials to IST wall-clock text', () => {
    expect(serialToDateTime(46285.4375)).toBe('2026-09-20 10:30:00');
    expect(serialToDateTime(46286)).toBe('2026-09-21');
  });
  it('imports numeric phones and serial dates, skips empty rows and reports bad ones by sheet row', () => {
    const preview = sync(grid);
    expect(preview.leads.map(l => [l.name, l.phone, l.acquiredAt, l.source])).toEqual([
      ['Asha', '+919000123410', '2026-09-20T10:30:00', 'Meta ads'],
      ['Meera', '+919000123411', '2026-09-21', 'WhatsApp'],
    ]);
    expect(preview.leads[0].acquisitions[0].cost).toBe(100);
    expect(preview.errors).toEqual([{ row: 6, reason: 'Use one valid Indian mobile number' }]);
  });
  it('writes nothing when the sheet is synced again unchanged', () => {
    const first = commitPreview(EMPTY, sync(grid));
    const again = sync(grid, first);
    expect(again.leads).toHaveLength(0);
    expect(again.duplicates).toBe(2);
  });
  it('adds a new row and a new source without disturbing call history', () => {
    const first = commitPreview(EMPTY, sync(grid));
    const input = { outcome: 'Connected / interested' as Outcome, note: '', intent: 'Wedding saree', store: 'MG', product: '', category: '', productLink: '', due: '', salesperson: 'Abishek' };
    first.leads[0] = recordCall(first.leads[0], input, '2026-09-22T12:00:00');
    const next = sync([...grid, ['Asha R', '9000123410', '', 'Google ads', 'CAM-9', '', 46290.5], ['Kavya', 9000123412, '', 'Referral']], first);
    expect(next.leads.map(l => l.name)).toEqual(['Asha', 'Kavya']);
    expect(next.updated).toBe(1);
    expect(next.leads[0].id).toBe(first.leads[0].id);
    expect(next.leads[0].status).toBe('Connected / interested');
    expect(next.leads[0].acquisitions.map(a => a.source)).toEqual(['Meta ads', 'Google ads']);
  });
  it('rejects a row with no source unless a default source is set', () => {
    expect(sync(grid, EMPTY, '').errors.map(e => e.row)).toEqual([4, 6]);
  });
  it('finds the headings under a title banner and matches a tracker tab by heading', () => {
    const tracker: unknown[][] = [
      ['DEEPAM BY ANANTA  ·  META ADS  ·  LEAD LOG', '', '', '', '', ''],
      ['Campaign Name', 'Full Name', 'Contact Number', 'Date and Time', 'Preferred Store', 'Source', 'EMAIL', 'Call 1 made '],
      ['Meta | 0001 | 2026 | 09 | Storevisit', 'Lily', 'p:+919004307096', '2026-10-01T22:06:08+05:30', 'mg_road', 'Meta', 'lily@example.com', ''],
      ['', '', '', '', '', '', '', ''],
    ];
    expect(findHeaderRow(tracker)).toBe(1);
    const tab = tabRows(tracker, '')!;
    expect(tab.first).toBe(3);
    expect(tab.mapping).toMatchObject({ phone: 'Contact Number', name: 'Full Name', campaignId: 'Campaign Name', preferredStore: 'Preferred Store', date: 'Date and Time', email: 'EMAIL' });
    const [lead] = previewRows(tab.rows, 'leads', CANONICAL, EMPTY).leads;
    expect(lead).toMatchObject({ phone: '+919004307096', source: 'Meta ads', preferredStore: 'MG', acquiredAt: '2026-10-01T22:06:08', campaignId: 'Meta | 0001 | 2026 | 09 | Storevisit' });
  });
  it('skips a tab that is not a lead list', () => {
    expect(tabRows([['CAMPAIGN SUMMARY'], ['Campaign name', 'Platform', 'Start date', 'No of leads', 'No of leads']], '')).toBeNull();
    expect(tabRows([], '')).toBeNull();
  });
  it('rejects a sheet with duplicate or missing headers', () => {
    expect(() => gridHeaders([['Name', 'Name']])).toThrow(/Duplicate/);
    expect(() => gridHeaders([])).toThrow(/No columns/);
  });
  it('picks up the lead form visit day and time slot columns', () => {
    const tab = tabRows([['full_name', 'phone_number', 'which_day_would_you_like_to_visit?', 'preferred_time_slot'], ['Asha', '9000123410', 'friday,_16_october', '2:30_pm_–_4:30_pm']], 'Meta ads')!;
    expect(tab.rows[0]).toMatchObject({ visitDay: 'friday,_16_october', visitSlot: '2:30_pm_–_4:30_pm' });
  });
});
