import { describe, expect, it } from 'vitest';
import { planSync, type FeedImport } from './hemparshwa';

const imp = (import_id: number, version: string, data_type = 'sales'): FeedImport => ({
  import_id, version, data_type, source: 'retail_erp', file_name: 'f.xlsx', file_sha256: 'x', rows_imported: 1,
  imported_at: '2026-10-08T10:19:20.003Z', period_from: null, period_to: null,
});

describe('Hemparshwa sync plan', () => {
  it('fetches imports CRM does not have and leaves matching ones alone', () => {
    const plan = planSync([imp(1, 'a'), imp(2, 'b')], [{ importId: 1, version: 'a' }]);
    expect(plan.remove).toEqual([]);
    expect(plan.fetch.map((i) => i.import_id)).toEqual([2]);
  });

  it('refetches an import whose rows changed', () => {
    expect(planSync([imp(1, 'b')], [{ importId: 1, version: 'a' }]).fetch.map((i) => i.import_id)).toEqual([1]);
  });

  it('removes imports that left the feed, as after an import data reset', () => {
    expect(planSync([], [{ importId: 1, version: 'a' }, { importId: 2, version: 'b' }])).toEqual({ remove: [1, 2], fetch: [] });
  });

  it('ignores data types whose rows are not served yet', () => {
    expect(planSync([imp(3, 'a', 'inventory')], [])).toEqual({ remove: [], fetch: [] });
  });
});
