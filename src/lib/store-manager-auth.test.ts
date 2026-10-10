import { describe, expect, it } from 'vitest';
import { isStoreManagerLogin } from './store-manager-auth';

describe('store manager credentials', () => {
  it('accepts only neena as both username and password', () => {
    expect(isStoreManagerLogin('neena', 'neena')).toBe(true);
    expect(isStoreManagerLogin('NEENA', 'neena')).toBe(true);
    expect(isStoreManagerLogin('neena', 'password')).toBe(false);
    expect(isStoreManagerLogin('other', 'neena')).toBe(false);
  });
});
