import { describe, it, expect } from 'vitest';
import { storeIdForBranch } from './branch-store';

const stores = [
  { id: 1, code: 'MG_ROAD', name: 'MG Road' },
  { id: 2, code: 'JAYANAGAR', name: 'Jayanagar' },
  { id: 3, code: 'ONLINE', name: 'Online' },
  { id: 7, code: 'EXHIBITION', name: 'Exhibition' },
  { id: 5, code: 'BLVD_COLLECTION', name: 'BLVD Collection' },
];

describe('storeIdForBranch', () => {
  it("maps the ERP's branch names to CRM stores", () => {
    expect(storeIdForBranch('MG', stores)).toBe(1);
    expect(storeIdForBranch('JAYANAGAR', stores)).toBe(2);
    expect(storeIdForBranch('ONLINE', stores)).toBe(3);
    expect(storeIdForBranch('EXHIBITION', stores)).toBe(7);
    expect(storeIdForBranch('BLVD Collection', stores)).toBe(5);
  });

  it('returns null for a blank or unknown branch', () => {
    expect(storeIdForBranch('', stores)).toBeNull();
    expect(storeIdForBranch(null, stores)).toBeNull();
    expect(storeIdForBranch('CHENNAI', stores)).toBeNull();
  });
});
