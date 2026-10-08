import { describe, expect, it } from 'vitest';
import { afterEach } from 'vitest';
import { planSync, type FeedImport } from './hemparshwa';
import { syncIntervalHours } from './hemparshwa-schedule';

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

describe('Hemparshwa sync interval', () => {
  afterEach(() => { delete process.env.HEMPARSHWA_SYNC_HOURS; });

  it('is five hours unless set, and off at zero or nonsense', () => {
    expect(syncIntervalHours()).toBe(5);
    process.env.HEMPARSHWA_SYNC_HOURS = '12';
    expect(syncIntervalHours()).toBe(12);
    process.env.HEMPARSHWA_SYNC_HOURS = '0';
    expect(syncIntervalHours()).toBe(0);
    process.env.HEMPARSHWA_SYNC_HOURS = 'often';
    expect(syncIntervalHours()).toBe(0);
  });
});
