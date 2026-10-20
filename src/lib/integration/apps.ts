/**
 * Read-only calls from CRM to the other apps, for the daily dashboard.
 * Each returns null when the app is not configured, unreachable or slow, so one app
 * being down never takes the page with it.
 *
 *  - RC Dashboard:        RC_URL + RC_INTEGRATION_TOKEN   -> GET /api/integration/daily?date=
 *  - Vendor Intelligence: VENDOR_URL + INTEGRATION_API_TOKEN (CRM's own token, which
 *                         Vendor Intelligence already holds) -> GET /api/integration/stock-alerts
 */

const TIMEOUT_MS = 6_000;

export type RcDaily = {
  date: string;
  day: { storeCode: string | null; visits: number; people: number; convertedVisits: number; billAmount: number | null; commission: number | null }[];
  owed: { storeCode: string | null; visits: number; commission: number | null }[];
};

export type StockAlerts = {
  asOf: string;
  salesThrough: string;
  rules: { agedDays: number; fastSellerDays: number; fastSellerMinSold: number; lowStockMax: number };
  stores: {
    storeCode: string;
    aged: { units: number; cost: number; items: { vendor: string; item: string; units: number; cost: number; oldestInward: string }[] };
    lowFastSellers: { vendor: string; item: string; left: number; soldLast30Days: number }[];
  }[];
};

async function getJson<T>(base: string | undefined, token: string | undefined, path: string, scope: string): Promise<T | null> {
  if (!base || !token) return null;
  try {
    const response = await fetch(new URL(path, base), {
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      console.warn(`[${scope}] ${response.status}`);
      return null;
    }
    return (await response.json()) as T;
  } catch (error) {
    console.warn(`[${scope}]`, error instanceof Error ? error.message : error);
    return null;
  }
}

export const getRcDaily = (date: string) =>
  getJson<RcDaily>(process.env.RC_URL, process.env.RC_INTEGRATION_TOKEN, `/api/integration/daily?date=${date}`, 'rc daily');

export const getStockAlerts = () =>
  getJson<StockAlerts>(process.env.VENDOR_URL, process.env.INTEGRATION_API_TOKEN, '/api/integration/stock-alerts', 'vendor stock alerts');
