import { describe, expect, it } from 'vitest';
import { parseMetaSpendExport } from './meta-spend-export';

const CSV = `Reporting starts,Reporting ends,Campaign name,Campaign delivery,Results,Result indicator,Amount spent (INR)
01/05/2026,30/10/2026,Instagram Post,inactive,,,0
01/05/2026,30/10/2026,Meta | 0001 | 2026 | 09 | Storevisit,active,4814,actions:leadgen.other,314505.72
01/05/2026,30/10/2026,Meta | 0011 | 2026 | 10 | BLVD Club Awareness,inactive,616741,reach,2995.1
01/05/2026,30/10/2026,Meta | 0001 | 2026 | 09 | Storevisit,active,10,actions:leadgen.other,100`;

describe('parseMetaSpendExport', () => {
  it('reads spend per campaign for the report period, leads only from lead results', () => {
    const parsed = parseMetaSpendExport(CSV);
    expect(parsed).toMatchObject({ from: '2026-05-01', to: '2026-10-30', skipped: 1, total: 317600.82 });
    expect(parsed.rows).toEqual([
      { campaign: 'Meta | 0001 | 2026 | 09 | Storevisit', platform: 'Meta ads', month: '2026-05-01..2026-10-30', week: '', spend: 314605.72, leads: 4824 },
      { campaign: 'Meta | 0011 | 2026 | 10 | BLVD Club Awareness', platform: 'Meta ads', month: '2026-05-01..2026-10-30', week: '', spend: 2995.1, leads: null },
    ]);
  });

  it('reads the "Meta report" layout: title rows first, campaign rows only, not their ad sets', () => {
    const report = `,Meta report Oct-31-2026 to Nov-10-2026,,,Report Period: Oct 31 2026 - Nov 10 2026,,,,,
,,,,,,,,,
,Campaign name,Ad set name,Delivery status,Delivery level,Result type,Results,Amount spent (INR),Reporting starts,Reporting ends
,Meta | 0016 | 2026 | 11 | Diwali Sale Online,All,active,campaign,Website purchases,1,15288.7,2026-10-31,2026-11-10
,,Prospecting,active,adset,Website purchases,1,4512.24,2026-10-31,2026-11-10
,Meta | 0001 | 2026 | 09 | Storevisit,All,active,campaign,Leads (form),159,9625.05,2026-10-31,2026-11-10
,,Storevisit set,active,adset,Leads (form),159,9625.05,2026-10-31,2026-11-10`;
    const parsed = parseMetaSpendExport(report);
    expect(parsed).toMatchObject({ from: '2026-10-31', to: '2026-11-10', skipped: 0, total: 24913.75 });
    expect(parsed.rows).toEqual([
      { campaign: 'Meta | 0016 | 2026 | 11 | Diwali Sale Online', platform: 'Meta ads', month: '2026-10-31..2026-11-10', week: '', spend: 15288.7, leads: null },
      { campaign: 'Meta | 0001 | 2026 | 09 | Storevisit', platform: 'Meta ads', month: '2026-10-31..2026-11-10', week: '', spend: 9625.05, leads: 159 },
    ]);
  });

  it('refuses a file that is not a Meta campaign export', () => {
    expect(() => parseMetaSpendExport('Name,Phone\nA,1')).toThrow(/Meta Ads Manager campaign export/);
  });
});
