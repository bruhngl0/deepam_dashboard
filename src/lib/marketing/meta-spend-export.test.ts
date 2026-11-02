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

  it('refuses a file that is not a Meta campaign export', () => {
    expect(() => parseMetaSpendExport('Name,Phone\nA,1')).toThrow(/Meta Ads Manager campaign export/);
  });
});
