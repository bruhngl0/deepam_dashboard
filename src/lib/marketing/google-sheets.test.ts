import { createVerify, generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { parseSpreadsheetId, readWorkbook, serviceAccount, SheetError } from './google-sheets';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const key = JSON.stringify({ client_email: 'crm@project.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('google sheets access', () => {
  beforeEach(() => { process.env.GOOGLE_SERVICE_ACCOUNT_KEY = key; });
  afterEach(() => { vi.unstubAllGlobals(); delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY; });

  it('reads a spreadsheet id from a link or a bare id', () => {
    expect(parseSpreadsheetId(`https://docs.google.com/spreadsheets/d/${ID}/edit?gid=0#gid=0`)).toBe(ID);
    expect(parseSpreadsheetId(ID)).toBe(ID);
    expect(parseSpreadsheetId('https://example.com/sheet')).toBeNull();
  });
  it('accepts the key as raw or base64 JSON and rejects anything else', () => {
    expect(serviceAccount()?.client_email).toBe('crm@project.iam.gserviceaccount.com');
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = Buffer.from(key).toString('base64');
    expect(serviceAccount()?.client_email).toBe('crm@project.iam.gserviceaccount.com');
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = 'not a key';
    expect(() => serviceAccount()).toThrow(SheetError);
    delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    expect(serviceAccount()).toBeNull();
  });
  it('signs a read-only token request and reads every tab unformatted', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.includes('oauth2')) return json({ access_token: 'tok', expires_in: 3600 });
      return url.includes('values:batchGet') ? json({ valueRanges: [{ values: [['Name'], ['Asha']] }, {}] }) : json({ properties: { title: 'Leads' }, sheets: [{ properties: { title: "Sept '26" } }, { properties: { title: 'Empty' } }] });
    }));
    expect(await readWorkbook(ID)).toEqual({ title: 'Leads', tabs: [{ name: "Sept '26", grid: [['Name'], ['Asha']] }, { name: 'Empty', grid: [] }] });

    const [header, claims, signature] = String((calls[0].init!.body as URLSearchParams).get('assertion')).split('.');
    expect(JSON.parse(Buffer.from(claims, 'base64url').toString())).toMatchObject({ iss: 'crm@project.iam.gserviceaccount.com', scope: 'https://www.googleapis.com/auth/spreadsheets.readonly' });
    expect(createVerify('RSA-SHA256').update(`${header}.${claims}`).verify(publicKey, signature, 'base64url')).toBe(true);
    expect(calls[2].url).toContain(`ranges=${encodeURIComponent("'Sept ''26'")}&`);
    expect(calls[2].url).toContain('valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER');
    expect((calls[2].init!.headers as Record<string, string>).authorization).toBe('Bearer tok');
  });
  it('explains an unshared sheet with the address to share it with', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('oauth2') ? json({ access_token: 'tok', expires_in: 3600 }) : json({ error: { message: 'The caller does not have permission' } }, 403)));
    await expect(readWorkbook(ID)).rejects.toThrow(/not shared with crm@project\.iam\.gserviceaccount\.com/);
  });
  it('without a key, downloads a link-shared sheet and keeps dates as serials', async () => {
    delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Full Name', 'Contact Number', 'Date and Time'], ['Asha', '+919000123410', new Date(Date.UTC(2026, 9, 1, 1, 3))]], { UTC: true }), 'Oct leads');
    const file = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const fetched: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { fetched.push(url); return new Response(new Uint8Array(file), { headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-disposition': `attachment; filename="x.xlsx"; filename*=UTF-8''Deepam%20%7C%20Leads.xlsx` } }); }));
    const workbook = await readWorkbook(ID);
    expect(fetched).toEqual([`https://docs.google.com/spreadsheets/d/${ID}/export?format=xlsx`]);
    expect(workbook.title).toBe('Deepam | Leads');
    expect(workbook.tabs[0].name).toBe('Oct leads');
    expect(workbook.tabs[0].grid[1][1]).toBe('+919000123410');
    expect(workbook.tabs[0].grid[1][2]).toBeCloseTo(46296.04375, 5);
  });
  it('without a key, says how to share a sheet that answers with a sign-in page', async () => {
    delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Sign in</html>', { headers: { 'content-type': 'text/html' } })));
    await expect(readWorkbook(ID)).rejects.toThrow(/Anyone with the link/);
  });
});
