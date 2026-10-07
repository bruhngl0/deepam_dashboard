/**
 * Read-only Google Sheets access, two ways.
 *
 * With a service account (GOOGLE_SERVICE_ACCOUNT_KEY, the downloaded JSON, raw
 * or base64): the sheet is shared with the account's email as a Viewer and
 * read through the Sheets API. No OAuth consent flow, no refresh token.
 *
 * Without one: the sheet must be shared as "Anyone with the link", and is
 * downloaded through Google's own export URL. Nothing to configure, but the
 * sheet is then readable by anyone who has the link.
 */

import { createSign } from 'node:crypto';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://sheets.googleapis.com/v4/spreadsheets';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const TIMEOUT_MS = 20_000;

type ServiceAccount = { client_email: string; private_key: string };

/** A failure the person connecting the sheet can act on; the message is shown as is. */
export class SheetError extends Error {}

export function serviceAccount(): ServiceAccount | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.trim();
  if (!raw) return null;
  try {
    const key = JSON.parse(raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8')) as Partial<ServiceAccount>;
    if (typeof key.client_email !== 'string' || typeof key.private_key !== 'string') throw new Error('missing fields');
    return { client_email: key.client_email, private_key: key.private_key };
  } catch {
    throw new SheetError('GOOGLE_SERVICE_ACCOUNT_KEY is not a valid service-account JSON key.');
  }
}

/** Accepts a full Google Sheets URL or a bare spreadsheet id. */
export function parseSpreadsheetId(input: string): string | null {
  const value = input.trim();
  return value.match(/\/spreadsheets\/d\/([\w-]{20,})/)?.[1] ?? (/^[\w-]{20,}$/.test(value) ? value : null);
}

let cached: { email: string; token: string; expires: number } | null = null;

async function accessToken(account: ServiceAccount): Promise<string> {
  if (cached && cached.email === account.client_email && cached.expires > Date.now() + 60_000) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${part({ alg: 'RS256', typ: 'JWT' })}.${part({ iss: account.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 })}`;
  let signature: string;
  try { signature = createSign('RSA-SHA256').update(unsigned).sign(account.private_key, 'base64url'); }
  catch { throw new SheetError('The private key in GOOGLE_SERVICE_ACCOUNT_KEY could not be used. Download a fresh JSON key.'); }
  const response = await fetch(TOKEN_URL, {
    method: 'POST', signal: AbortSignal.timeout(TIMEOUT_MS),
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
  });
  const body = await response.json().catch(() => null) as { access_token?: string; expires_in?: number; error_description?: string } | null;
  if (!response.ok || !body?.access_token) throw new SheetError(`Google rejected the service account: ${body?.error_description ?? `HTTP ${response.status}`}`);
  cached = { email: account.client_email, token: body.access_token, expires: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return cached.token;
}

async function api<T>(path: string): Promise<T> {
  const account = serviceAccount();
  if (!account) throw new SheetError('GOOGLE_SERVICE_ACCOUNT_KEY is not set on the server.');
  const response = await fetch(`${API}/${path}`, { headers: { authorization: `Bearer ${await accessToken(account)}` }, signal: AbortSignal.timeout(TIMEOUT_MS), cache: 'no-store' });
  if (response.ok) return await response.json() as T;
  const detail = (await response.json().catch(() => null) as { error?: { message?: string } } | null)?.error?.message ?? `HTTP ${response.status}`;
  if (response.status === 404) throw new SheetError('Spreadsheet not found. Check the link.');
  if (response.status === 403 && /permission/i.test(detail)) throw new SheetError(`The sheet is not shared with ${account.client_email}. Share it with that address as a Viewer.`);
  if (response.status === 400 && /parse range/i.test(detail)) throw new SheetError('That worksheet tab no longer exists in the spreadsheet.');
  throw new SheetError(`Google Sheets: ${detail}`);
}

export type Workbook = { title: string; tabs: { name: string; grid: unknown[][] }[] };

async function readWithApi(spreadsheetId: string): Promise<Workbook> {
  const info = await api<{ properties?: { title?: string }; sheets?: { properties?: { title?: string } }[] }>(`${spreadsheetId}?fields=properties.title,sheets.properties.title`);
  const names = (info.sheets ?? []).map((s) => s.properties?.title ?? '').filter(Boolean);
  if (!names.length) return { title: info.properties?.title ?? '', tabs: [] };
  // Unformatted, so a phone stays a whole number and a date arrives as a serial, whatever the sheet's locale.
  const ranges = names.map((n) => `ranges=${encodeURIComponent(`'${n.replace(/'/g, "''")}'`)}`).join('&');
  const body = await api<{ valueRanges?: { values?: unknown[][] }[] }>(`${spreadsheetId}/values:batchGet?${ranges}&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`);
  return { title: info.properties?.title ?? '', tabs: names.map((name, i) => ({ name, grid: body.valueRanges?.[i]?.values ?? [] })) };
}

async function readPublicExport(spreadsheetId: string): Promise<Workbook> {
  const response = await fetch(`https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=xlsx`, { signal: AbortSignal.timeout(TIMEOUT_MS * 3), cache: 'no-store' });
  if (response.status === 404) throw new SheetError('Spreadsheet not found. Check the link.');
  // A private sheet answers with a sign-in page rather than an error status.
  if (!response.ok || !(response.headers.get('content-type') ?? '').includes('spreadsheetml')) {
    throw new SheetError('This sheet is not readable by link. In Google Sheets choose Share → General access → "Anyone with the link" (Viewer), then try again.');
  }
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(Buffer.from(await response.arrayBuffer()), { type: 'buffer' });
  const name = response.headers.get('content-disposition')?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  let title = '';
  try { title = decodeURIComponent(name ?? '').replace(/\.xlsx$/i, ''); } catch { /* keep the title blank */ }
  // `raw` keeps date cells as serial numbers, the same as the API path, so times never pass through a server timezone.
  return { title, tabs: workbook.SheetNames.map((tab) => ({ name: tab, grid: XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[tab], { header: 1, defval: '', blankrows: true, raw: true }) })) };
}

/** Every tab of a spreadsheet, as raw cell values. */
export async function readWorkbook(spreadsheetId: string): Promise<Workbook> {
  return serviceAccount() ? readWithApi(spreadsheetId) : readPublicExport(spreadsheetId);
}
