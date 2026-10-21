import { afterEach, describe, expect, it } from 'vitest';
import { POST } from './route';

const saved = { token: process.env.INTEGRATION_API_TOKEN, url: process.env.ANALYTICS_DATABASE_URL };
afterEach(() => {
  process.env.INTEGRATION_API_TOKEN = saved.token;
  if (saved.url === undefined) delete process.env.ANALYTICS_DATABASE_URL;
  else process.env.ANALYTICS_DATABASE_URL = saved.url;
});

const call = (auth?: string) =>
  POST(new Request('http://crm.test/api/integration/analytics/refresh', { method: 'POST', headers: auth ? { authorization: auth } : {} }));

describe('analytics refresh route', () => {
  it('refuses a request without the integration token', async () => {
    process.env.INTEGRATION_API_TOKEN = 'test-token-for-route';
    expect((await call()).status).toBe(401);
    expect((await call('Bearer wrong')).status).toBe(401);
  });

  it('says so when analytics is not configured', async () => {
    process.env.INTEGRATION_API_TOKEN = 'test-token-for-route';
    delete process.env.ANALYTICS_DATABASE_URL;
    (globalThis as { analyticsPool?: unknown }).analyticsPool = undefined;
    expect((await call('Bearer test-token-for-route')).status).toBe(503);
  });
});
