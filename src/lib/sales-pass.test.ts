import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readSalesPass } from './sales-pass';

const SECRET = 'x'.repeat(40);
const ORIGIN = 'https://crm.example.com';
const mint = (claims: object, secret = SECRET) => {
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
};
const soon = () => Math.floor(Date.now() / 1000) + 60;

describe('sales pass from Hemparshwa OS', () => {
  const before = process.env.ADMIN_SSO_SECRET;
  beforeAll(() => { process.env.ADMIN_SSO_SECRET = SECRET; });
  afterAll(() => { process.env.ADMIN_SSO_SECRET = before; });

  it('accepts a fresh sales pass for this app', () => {
    expect(readSalesPass(mint({ sub: 'DBYA0027', role: 'sales', aud: ORIGIN, exp: soon() }), ORIGIN)).toBe('DBYA0027');
  });
  it('refuses forged, expired, admin, other-app and long-lived passes', () => {
    expect(readSalesPass(mint({ sub: 'DBYA0027', role: 'sales', aud: ORIGIN, exp: soon() }, 'y'.repeat(40)), ORIGIN)).toBeNull();
    expect(readSalesPass(mint({ sub: 'DBYA0027', role: 'sales', aud: ORIGIN, exp: soon() - 120 }), ORIGIN)).toBeNull();
    expect(readSalesPass(mint({ sub: 'U-ADMIN', role: 'admin', aud: ORIGIN, exp: soon() }), ORIGIN)).toBeNull();
    expect(readSalesPass(mint({ sub: 'DBYA0027', role: 'sales', aud: 'https://other.example.com', exp: soon() }), ORIGIN)).toBeNull();
    expect(readSalesPass(mint({ sub: 'DBYA0027', role: 'sales', aud: ORIGIN, exp: soon() + 3600 }), ORIGIN)).toBeNull();
    expect(readSalesPass('garbage', ORIGIN)).toBeNull();
  });
});
