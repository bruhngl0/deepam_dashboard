/**
 * Loads one campaign's leads, bills, Walktrack visits, spend and saved event
 * settings, and works out its KPIs with `campaignKpis` (./campaign-report).
 */

import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { settings } from '@/db/schema';
import { campaignKey } from './campaign-spend';
import { campaignSpend } from './lead-type-conversions-store';
import { campaignKind, type CampaignKind } from './lead-type-conversions';
import {
  campaignKpis, NO_SETTINGS, overlaps, parseSettings, suggestVenue,
  type CampaignKpis, type CampaignSettings, type ReportBill, type ReportVisit,
} from './campaign-report';

const SETTINGS_KEY = 'marketing_campaign_settings';
/** Regular stores and the shared Exhibition till: never an event venue. */
const NOT_VENUES = ['MG_ROAD', 'JAYANAGAR', 'ONLINE', 'EXHIBITION'];

const rowsOf = <T>(result: unknown): T[] =>
  Array.isArray(result) ? (result as T[]) : ((result as { rows?: T[] }).rows ?? []);

type Venue = { id: number; name: string; firstVisit: string | null; lastVisit: string | null };
export type CampaignReport = {
  campaign: string;
  kind: CampaignKind;
  sources: string[];
  firstLead: string | null;
  lastLead: string | null;
  settings: CampaignSettings;
  /** True when the settings are suggested from the campaign name and Walktrack, not saved. */
  suggested: boolean;
  venues: Venue[];
  /** Other campaigns at a different venue whose event dates overlap: their Exhibition till bills are counted in both. */
  overlapping: string[];
  kpis: CampaignKpis;
  spendError: string | null;
  latestBill: string | null;
};

async function savedSettings(): Promise<Record<string, CampaignSettings>> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, SETTINGS_KEY)).limit(1);
  const value = (row?.value ?? {}) as Record<string, unknown>;
  const out: Record<string, CampaignSettings> = {};
  for (const [key, raw] of Object.entries(value)) {
    const parsed = parseSettings(raw);
    if (typeof parsed !== 'string') out[key] = parsed;
  }
  return out;
}

export async function saveCampaignSettings(campaign: string, value: CampaignSettings) {
  const all = await savedSettings();
  all[campaignKey(campaign)] = value;
  await db.insert(settings).values({ key: SETTINGS_KEY, value: all, description: 'Event venue, dates and exhibition expense per marketing campaign.' })
    .onConflictDoUpdate({ target: settings.key, set: { value: all, updatedAt: sql`now()` } });
}

async function venues(): Promise<Venue[]> {
  const rows = rowsOf<{ id: number; name: string; first_visit: string | null; last_visit: string | null }>(await db.execute(sql`
    SELECT st.id, st.name,
           to_char(min(v.visited_at AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM-DD') AS first_visit,
           to_char(max(v.visited_at AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM-DD') AS last_visit
    FROM stores st LEFT JOIN store_visits v ON v.store_id = st.id AND v.deleted_at IS NULL
    WHERE st.code NOT IN (${sql.join(NOT_VENUES.map((code) => sql`${code}`), sql`, `)})
    GROUP BY st.id, st.name ORDER BY st.name`));
  return rows.map((row) => ({ id: Number(row.id), name: String(row.name), firstVisit: row.first_visit, lastVisit: row.last_visit }));
}

/** Saved settings, or a suggestion: the venue named in the campaign, over the days Walktrack recorded visits there. */
function settingsFor(campaign: string, saved: Record<string, CampaignSettings>, places: Venue[]): { value: CampaignSettings; suggested: boolean } {
  const own = saved[campaignKey(campaign)];
  if (own) return { value: own, suggested: false };
  const venue = suggestVenue(campaign, places);
  const found = places.find((place) => place.id === venue?.id);
  if (!found?.firstVisit || !found.lastVisit) return { value: NO_SETTINGS, suggested: false };
  return { value: { ...NO_SETTINGS, venueStoreId: found.id, from: found.firstVisit, to: found.lastVisit }, suggested: true };
}

export async function campaignReport(campaign: string): Promise<CampaignReport | null> {
  const key = campaignKey(campaign);
  const leadsCte = sql`
    leads AS (
      SELECT ml.phone, right(regexp_replace(ml.phone, '[^0-9]', '', 'g'), 10) AS p10,
             NULLIF(left(ml.doc->>'date', 10), '')::date AS d
      FROM marketing_leads ml
      WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(ml.doc->'acquisitions', '[]'::jsonb)) a
                    WHERE lower(regexp_replace(coalesce(a->>'campaignId', ''), '\\s', '', 'g')) = ${key})
    ),
    lead_bills AS (
      SELECT s.id, min(l.d) AS since
      FROM leads l JOIN customers c ON c.phone_e164 = l.phone JOIN sales s ON s.customer_id = c.id
      WHERE s.bill_amount > 0 AND l.d IS NOT NULL AND (s.billed_at AT TIME ZONE 'Asia/Kolkata')::date >= l.d
      GROUP BY s.id
    )`;

  const [names, summary, saved, places, spend, latest] = await Promise.all([
    db.execute(sql`
      SELECT a->>'campaignId' AS campaign, array_agg(DISTINCT coalesce(a->>'source', '')) AS sources,
             min(left(ml.doc->>'date', 10)) AS first_lead, max(left(ml.doc->>'date', 10)) AS last_lead
      FROM marketing_leads ml, jsonb_array_elements(coalesce(ml.doc->'acquisitions', '[]'::jsonb)) a
      WHERE coalesce(a->>'campaignId', '') <> '' GROUP BY 1`),
    db.execute(sql`WITH ${leadsCte}
      SELECT count(*)::int AS leads,
             count(*) FILTER (WHERE EXISTS (
               SELECT 1 FROM customers c JOIN sales s ON s.customer_id = c.id
               WHERE c.phone_e164 = l.phone AND s.bill_amount > 0 AND l.d IS NOT NULL
                 AND (s.billed_at AT TIME ZONE 'Asia/Kolkata')::date >= l.d))::int AS converted
      FROM leads l`),
    savedSettings(),
    venues(),
    campaignSpend().then((value) => ({ value, error: null as string | null }), (error: unknown) => ({
      value: [], error: error instanceof Error ? error.message : 'Could not read the Campaign Summary tabs.',
    })),
    db.execute(sql`SELECT to_char(max(billed_at) AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS latest FROM sales`),
  ]);

  const all = rowsOf<{ campaign: string; sources: string[]; first_lead: string | null; last_lead: string | null }>(names);
  const mine = all.filter((row) => campaignKey(row.campaign) === key);
  if (!mine.length) return null;
  const title = mine.map((row) => row.campaign.trim()).sort()[0];

  const { value: setting, suggested } = settingsFor(title, saved, places);
  const event = setting.venueStoreId !== null && !!setting.from;
  const venueId = setting.venueStoreId ?? -1;
  const from = setting.from || '1900-01-01', to = setting.to || '1900-01-01';

  const [billRows, visitRows] = await Promise.all([
    db.execute(sql`WITH ${leadsCte},
      event_bills AS (
        SELECT s.id FROM sales s JOIN stores st ON st.id = s.store_id
        WHERE ${event}::boolean AND s.bill_amount > 0 AND (st.id = ${venueId} OR st.code = 'EXHIBITION')
          AND (s.billed_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN ${from}::date AND ${to}::date
      ),
      picked AS (SELECT id FROM lead_bills UNION SELECT id FROM event_bills)
      SELECT s.id::text AS id, s.bill_amount::float AS amount, s.customer_id::text AS customer_id,
             to_char(s.billed_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS date,
             to_char(lb.since, 'YYYY-MM-DD') AS lead_since, eb.id IS NOT NULL AS at_event,
             -- The earlier of their first CRM bill and the first bill in the loyalty records, which go back before the CRM.
             to_char(LEAST(
               (SELECT min((s2.billed_at AT TIME ZONE 'Asia/Kolkata')::date) FROM sales s2 WHERE s2.customer_id = s.customer_id AND s2.bill_amount > 0),
               (SELECT min(lc.first_bill_date) FROM loyalty_customers lc WHERE lc.customer_id = s.customer_id)
             ), 'YYYY-MM-DD') AS first_bill,
             (SELECT sum(li.purc_value)::float FROM sale_line_items li WHERE li.sale_id = s.id AND li.purc_value IS NOT NULL) AS cost
      FROM picked p JOIN sales s ON s.id = p.id
      LEFT JOIN lead_bills lb ON lb.id = s.id LEFT JOIN event_bills eb ON eb.id = s.id`),
    db.execute(sql`WITH ${leadsCte}
      SELECT v.id::text AS id, v.people, v.staff_converted AS converted
      FROM store_visits v
      WHERE v.deleted_at IS NULL AND (
        (${event}::boolean AND v.store_id = ${venueId}
          AND (v.visited_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN ${from}::date AND ${to}::date)
        OR EXISTS (SELECT 1 FROM leads l
          WHERE l.d IS NOT NULL AND length(l.p10) = 10
            AND l.p10 = right(regexp_replace(coalesce(v.raw->>'contactNo', ''), '[^0-9]', '', 'g'), 10)
            AND (v.visited_at AT TIME ZONE 'Asia/Kolkata')::date >= l.d))`),
  ]);

  const bills: ReportBill[] = rowsOf<Record<string, unknown>>(billRows).map((row) => {
    const leadSince = row.lead_since ? String(row.lead_since) : null;
    const atEvent = row.at_event === true;
    const since = [leadSince, atEvent ? setting.from : null].filter((d): d is string => !!d).sort()[0] ?? String(row.date);
    return {
      id: String(row.id), amount: Number(row.amount), date: String(row.date),
      customerId: row.customer_id ? String(row.customer_id) : null,
      firstBill: row.first_bill ? String(row.first_bill) : null,
      fromLead: !!leadSince, atEvent, since,
      cost: row.cost === null || row.cost === undefined ? null : Number(row.cost),
    };
  });
  const visits: ReportVisit[] = rowsOf<Record<string, unknown>>(visitRows).map((row) => ({
    id: String(row.id), people: Number(row.people) || 1, converted: row.converted === true,
  }));
  const counts = rowsOf<{ leads: number; converted: number }>(summary)[0] ?? { leads: 0, converted: 0 };
  const spendRow = spend.value.find((row) => campaignKey(row.campaign) === key);

  // Other campaigns at another venue on overlapping dates share the Exhibition till's bills.
  const overlapping = event ? [...new Set(all.map((row) => row.campaign.trim()))].filter((other) => {
    if (campaignKey(other) === key) return false;
    const theirs = settingsFor(other, saved, places).value;
    return theirs.venueStoreId !== null && theirs.venueStoreId !== setting.venueStoreId && overlaps(setting, theirs);
  }) : [];

  const days = mine.flatMap((row) => [row.first_lead, row.last_lead]).filter((d): d is string => !!d).sort();
  return {
    campaign: title,
    kind: campaignKind(title),
    sources: [...new Set(mine.flatMap((row) => row.sources).filter(Boolean))],
    firstLead: days[0] ?? null,
    lastLead: days.at(-1) ?? null,
    settings: setting,
    suggested,
    venues: places,
    overlapping,
    kpis: campaignKpis({ leads: counts.leads, convertedLeads: counts.converted, bills, visits, spend: spendRow ? spendRow.spend : null, settings: setting }),
    spendError: spend.error,
    latestBill: rowsOf<{ latest: string | null }>(latest)[0]?.latest ?? null,
  };
}
