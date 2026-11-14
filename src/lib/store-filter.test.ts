import { describe, expect, it, vi } from 'vitest';

vi.mock('@/db', () => ({ db: {} }));
import { parseStores, storeCodes, storeMatches, storesLabel } from './store-filter';
import { parseStoreParam, storeCondition, storeInList } from './queries/dashboard';

const CRM = /^[A-Z0-9_]{1,40}$/;

describe('parseStores', () => {
  it('keeps a single store as before', () => expect(parseStores('MG_ROAD', CRM)).toBe('MG_ROAD'));
  it('reads a comma list, sorted and without repeats', () => expect(parseStores('JAYANAGAR, MG_ROAD,JAYANAGAR', CRM)).toBe('JAYANAGAR,MG_ROAD'));
  it('reads repeated params (a GET form of checkboxes)', () => expect(parseStores(['STR-002', 'STR-001'], /^STR-\d{3}$/)).toBe('STR-001,STR-002'));
  it('drops codes that fail the pattern', () => expect(parseStores("MG_ROAD,x' OR 1=1--", CRM)).toBe('MG_ROAD'));
  it('is null for nothing picked', () => {
    expect(parseStores('', CRM)).toBeNull();
    expect(parseStores(undefined, CRM)).toBeNull();
    expect(parseStores("'; DROP TABLE x", CRM)).toBeNull();
  });
});

describe('store list helpers', () => {
  it('splits and matches', () => {
    expect(storeCodes('A,B')).toEqual(['A', 'B']);
    expect(storeMatches('A,B', 'B')).toBe(true);
    expect(storeMatches('A,B', 'C')).toBe(false);
    expect(storeMatches(null, 'C')).toBe(true);
    expect(storeMatches('A', null)).toBe(false);
  });
  it('labels', () => {
    const list = [{ code: 'A', name: 'MG Road' }, { code: 'B', name: 'Jayanagar' }];
    expect(storesLabel(null, list)).toBe('All stores');
    expect(storesLabel('A,B', list)).toBe('MG Road, Jayanagar');
  });
});

describe('dashboard store SQL', () => {
  it('builds an IN list from checked codes', () => {
    expect(storeInList(parseStoreParam('MG_ROAD,JAYANAGAR')!)).toBe("('JAYANAGAR', 'MG_ROAD')");
    expect(storeCondition('s', { store: 'MG_ROAD,JAYANAGAR' })).toBe(" AND s.store_id IN (SELECT id FROM stores WHERE code IN ('JAYANAGAR', 'MG_ROAD'))");
    expect(storeCondition('s', { store: "MG_ROAD'--" })).toBe('');
  });
});
