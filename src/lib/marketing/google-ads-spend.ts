/**
 * Google ad spend from the Google Ads API: one row of marketing_campaign_spend
 * per campaign and day (month "2026-10", week holds the day "2026-10-21"), for
 * every day from GOOGLE_ADS_SPEND_FROM to today. Each sync replaces all Google
 * spend; Meta spend is not touched (see ./campaign-spend). Leads still come
 * from the sheet sync.
 *
 * Off until these are set (see DEPLOY_AWS.md, "Google Ads spend"):
 *   GOOGLE_ADS_DEVELOPER_TOKEN   from the manager account's API Center
 *   GOOGLE_ADS_CLIENT_ID         OAuth client (Google Cloud, Google Ads API enabled)
 *   GOOGLE_ADS_CLIENT_SECRET
 *   GOOGLE_ADS_REFRESH_TOKEN     from scripts/google-ads-refresh-token.ts
 *   GOOGLE_ADS_CUSTOMER_ID       the ad account, digits only or 123-456-7890
 * Optional:
 *   GOOGLE_ADS_LOGIN_CUSTOMER_ID the manager account, when access goes through one
 *   GOOGLE_ADS_SPEND_FROM        first day to load (default 2026-01-01)
 *   GOOGLE_ADS_API_VERSION       default v26
 */

import { saveCampaignSpend, SPEND_PLATFORMS, type CampaignSpendWeek } from './campaign-spend';

export type GoogleAdsConfig = {
  developerToken: string; clientId: string; clientSecret: string; refreshToken: string;
  customerId: string; loginCustomerId: string | null; from: string; version: string;
};

const digits = (value: string | undefined) => (value ?? '').replace(/\D/g, '');

/** The settings, or null while any required one is missing (the sync is then off). */
export function googleAdsConfig(env: Record<string, string | undefined> = process.env): GoogleAdsConfig | null {
  const developerToken = env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim(), clientId = env.GOOGLE_ADS_CLIENT_ID?.trim(),
    clientSecret = env.GOOGLE_ADS_CLIENT_SECRET?.trim(), refreshToken = env.GOOGLE_ADS_REFRESH_TOKEN?.trim();
  const customerId = digits(env.GOOGLE_ADS_CUSTOMER_ID);
  if (!developerToken || !clientId || !clientSecret || !refreshToken || !customerId) return null;
  const from = /^\d{4}-\d{2}-\d{2}$/.test(env.GOOGLE_ADS_SPEND_FROM ?? '') ? env.GOOGLE_ADS_SPEND_FROM! : '2026-01-01';
  return {
    developerToken, clientId, clientSecret, refreshToken, customerId,
    loginCustomerId: digits(env.GOOGLE_ADS_LOGIN_CUSTOMER_ID) || null, from,
    version: /^v\d+$/.test(env.GOOGLE_ADS_API_VERSION ?? '') ? env.GOOGLE_ADS_API_VERSION! : 'v26',
  };
}

export const googleAdsConfigured = () => googleAdsConfig() !== null;

/** Today in India time, as YYYY-MM-DD. */
const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

/** GAQL for campaign spend by day. Only days with spend come back. */
export function spendQuery(from: string, to: string): string {
  return `SELECT campaign.id, campaign.name, segments.date, metrics.cost_micros
FROM campaign
WHERE segments.date BETWEEN '${from}' AND '${to}' AND metrics.cost_micros > 0`;
}

type Row = { campaign?: { name?: string }; segments?: { date?: string }; metrics?: { costMicros?: string | number; cost_micros?: string | number } };

/** API result rows → spend rows. Cost is in micros (₹1 = 1,000,000). */
export function spendRowsFromResults(results: Row[]): CampaignSpendWeek[] {
  const rows: CampaignSpendWeek[] = [];
  for (const row of results) {
    const campaign = row.campaign?.name?.trim(), day = row.segments?.date ?? '';
    const micros = Number(row.metrics?.costMicros ?? row.metrics?.cost_micros ?? 0);
    if (!campaign || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !(micros > 0)) continue;
    rows.push({ campaign, platform: SPEND_PLATFORMS.google, month: day.slice(0, 7), week: day, spend: Math.round(micros / 10_000) / 100, leads: null });
  }
  return rows;
}

async function accessToken(config: GoogleAdsConfig): Promise<string> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, refresh_token: config.refreshToken, grant_type: 'refresh_token' }),
  });
  const body = await response.json().catch(() => ({})) as { access_token?: string; error?: string; error_description?: string };
  if (!response.ok || !body.access_token) throw new Error(`Google sign-in failed: ${body.error_description || body.error || response.status}`);
  return body.access_token;
}

/** Every campaign-day of spend from `config.from` to `to` (default today, India time). */
export async function fetchGoogleAdsSpend(config: GoogleAdsConfig, to = istToday()): Promise<CampaignSpendWeek[]> {
  const token = await accessToken(config);
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, 'developer-token': config.developerToken, 'Content-Type': 'application/json' };
  if (config.loginCustomerId) headers['login-customer-id'] = config.loginCustomerId;
  const url = `https://googleads.googleapis.com/${config.version}/customers/${config.customerId}/googleAds:search`;
  const results: Row[] = [];
  let pageToken: string | undefined;
  do {
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ query: spendQuery(config.from, to), ...(pageToken ? { pageToken } : {}) }) });
    const body = await response.json().catch(() => ({})) as { results?: Row[]; nextPageToken?: string; error?: { message?: string; status?: string } };
    if (!response.ok) throw new Error(`Google Ads API: ${body.error?.message || body.error?.status || response.status}`);
    results.push(...(body.results ?? []));
    pageToken = body.nextPageToken || undefined;
  } while (pageToken);
  return spendRowsFromResults(results);
}

export type GoogleAdsSyncResult =
  | { state: 'off'; missing: string }
  | { state: 'ok'; from: string; to: string; campaigns: number; days: number; total: number };

/** Loads Google spend from the API and replaces all saved Google spend. */
export async function syncGoogleAdsSpend(options: { apply?: boolean } = {}): Promise<GoogleAdsSyncResult & { rows?: CampaignSpendWeek[] }> {
  const config = googleAdsConfig();
  if (!config) return { state: 'off', missing: 'Set GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET, GOOGLE_ADS_REFRESH_TOKEN and GOOGLE_ADS_CUSTOMER_ID.' };
  const to = istToday();
  const rows = await fetchGoogleAdsSpend(config, to);
  if (options.apply !== false) {
    await saveCampaignSpend(rows, SPEND_PLATFORMS.google);
    // The campaign pages cache spend for a minute (lead-type-conversions-store): show the new figures now.
    delete (globalThis as typeof globalThis & { __campaignSpend?: unknown }).__campaignSpend;
  }
  return {
    state: 'ok', from: config.from, to, rows,
    campaigns: new Set(rows.map((r) => r.campaign)).size, days: rows.length,
    total: Math.round(rows.reduce((sum, r) => sum + r.spend, 0) * 100) / 100,
  };
}
