/**
 * New customers: everyone who bought in the period and is not on the loyalty
 * customer list, the CRM's record of people who had already bought.
 *
 * Each one falls in exactly one group, in this order:
 * - lead:   on a lead sheet (Meta, WhatsApp, Google Ads or other sources);
 * - walkin: no lead sheet, but logged another way, chiefly as a walk-in;
 * - other:  no lead sheet, not logged anywhere: known only from the bill.
 *
 * Foreign numbers are left out, as everywhere else on the dashboard. The
 * dashboard's New customers tile and /crm/new-customers both read from here, so
 * the tile and the page always agree.
 */

import { db } from '@/db';
import { sql } from 'drizzle-orm';
import { scopeCondition, SCOPED_CHANNELS, type DateRange } from './dashboard';

export const NEW_CUSTOMER_SEGMENTS = ['lead', 'walkin', 'other'] as const;
export type NewCustomerSegment = (typeof NEW_CUSTOMER_SEGMENTS)[number];

export const NEW_CUSTOMER_SEGMENT_INFO: Record<NewCustomerSegment, { label: string; definition: string }> = {
  lead: { label: 'From lead sheets', definition: 'On a Meta, WhatsApp, Google Ads or other lead sheet.' },
  walkin: { label: 'Walk-ins', definition: 'Not on a lead sheet, but logged another way, chiefly as a store walk-in.' },
  other: { label: 'Other new buyers', definition: 'Not on a lead sheet and not logged as a walk-in: known only from their bill.' },
};

export function newCustomerSegmentParam(value: string | undefined): NewCustomerSegment | undefined {
  return NEW_CUSTOMER_SEGMENTS.includes(value as NewCustomerSegment) ? (value as NewCustomerSegment) : undefined;
}

type Row = Record<string, unknown>;

async function query(text: string): Promise<Row[]> {
  const result = (await db.execute(sql.raw(text))) as unknown;
  return Array.isArray(result) ? (result as Row[]) : ((result as { rows: Row[] }).rows ?? []);
}

const LEAD_CHANNELS = SCOPED_CHANNELS.map((c) => `'${c}'`).join(',');

/** A new customer's group, for the customer in `<alias>.customer_id`. */
function segmentCase(alias: string): string {
  return `CASE
             WHEN EXISTS (SELECT 1 FROM lead_touches lt WHERE lt.customer_id = ${alias}.customer_id AND lt.channel IN (${LEAD_CHANNELS})) THEN 'lead'
             WHEN EXISTS (SELECT 1 FROM lead_touches lt WHERE lt.customer_id = ${alias}.customer_id) THEN 'walkin'
             ELSE 'other'
           END`;
}

/** `new_buyers`: one row per new customer with their bills in the period, and their group. */
function newBuyers(range: DateRange): string {
  return `
  new_buyers AS (
    SELECT s.customer_id,
           COUNT(*)::int                  AS bills,
           COALESCE(SUM(s.bill_amount), 0)::float8 AS sales,
           to_char(MIN(s.billed_at) AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS first_bill,
           to_char(MAX(s.billed_at) AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS last_bill,
           ${segmentCase('s')} AS segment
    FROM   sales s
    JOIN   customers c ON c.id = s.customer_id
    WHERE  NOT c.is_foreign
      AND  NOT EXISTS (SELECT 1 FROM loyalty_customers lc WHERE lc.customer_id = c.id)${scopeCondition('s', range)}
    GROUP  BY s.customer_id
  )`;
}

export type NewCustomerGroup = { buyers: number; bills: number; sales: number };
export type NewCustomerSummary = Record<NewCustomerSegment | 'all', NewCustomerGroup>;

export async function getNewCustomerSummary(range: DateRange = {}): Promise<NewCustomerSummary> {
  const rows = await query(`
    WITH ${newBuyers(range)}
    SELECT segment, COUNT(*)::int AS buyers, COALESCE(SUM(bills), 0)::int AS bills, COALESCE(SUM(sales), 0)::float8 AS sales
    FROM   new_buyers
    GROUP  BY ROLLUP (segment)`);
  const empty = (): NewCustomerGroup => ({ buyers: 0, bills: 0, sales: 0 });
  const summary: NewCustomerSummary = { all: empty(), lead: empty(), walkin: empty(), other: empty() };
  for (const row of rows) {
    const key = (row.segment ?? 'all') as keyof NewCustomerSummary;
    summary[key] = { buyers: Number(row.buyers ?? 0), bills: Number(row.bills ?? 0), sales: Number(row.sales ?? 0) };
  }
  return summary;
}

export type NewCustomerRow = {
  customerId: number;
  customerCode: string | null;
  name: string | null;
  phone: string;
  segment: NewCustomerSegment;
  /** Lead sheet channel and campaign of their first touch, or how they were logged. */
  source: string | null;
  /** India-time days, YYYY-MM-DD. */
  firstBill: string;
  lastBill: string;
  store: string | null;
  bills: number;
  sales: number;
};

export type NewCustomerList = { rows: NewCustomerRow[]; total: number; page: number; pageSize: number; pageCount: number };

export async function getNewCustomerList(
  range: DateRange,
  options: { segment?: NewCustomerSegment; q?: string; page?: number; pageSize?: number } = {},
): Promise<NewCustomerList> {
  const pageSize = Math.min(Math.max(Math.trunc(options.pageSize ?? 50) || 50, 10), 200);
  const page = Math.max(Math.trunc(options.page ?? 1) || 1, 1);
  const segment = options.segment ? ` AND nb.segment = '${options.segment}'` : '';
  // Search text only ever reaches SQL as digits or as a quoted, escaped LIKE pattern.
  const q = (options.q ?? '').trim();
  const digits = q.replace(/\D/g, '');
  const text = q.replace(/[\\%_]/g, (m) => `\\${m}`).replace(/'/g, "''");
  const search = q
    ? ` AND (c.full_name ILIKE '%${text}%' OR c.customer_code ILIKE '%${text}%'${digits.length >= 3 ? ` OR c.phone_e164 LIKE '%${digits}%'` : ''})`
    : '';
  const rows = await query(`
    WITH ${newBuyers(range)}
    SELECT nb.*, c.customer_code, c.full_name, c.phone_e164,
           COUNT(*) OVER ()::int AS total,
           (SELECT st.name FROM sales s JOIN stores st ON st.id = s.store_id
             WHERE s.customer_id = nb.customer_id${scopeCondition('s', range)} ORDER BY s.billed_at LIMIT 1) AS store,
           (SELECT CASE WHEN lt.channel IN (${LEAD_CHANNELS}) THEN initcap(lt.channel::text) || COALESCE(' · ' || cp.name, '') ELSE replace(initcap(lt.channel::text), 'Walkin', 'Walk-in') END
              FROM lead_touches lt LEFT JOIN campaigns cp ON cp.id = lt.campaign_id
             WHERE lt.customer_id = nb.customer_id
             ORDER BY (lt.channel IN (${LEAD_CHANNELS})) DESC, lt.touched_at LIMIT 1) AS source
    FROM   new_buyers nb
    JOIN   customers c ON c.id = nb.customer_id
    WHERE  true${segment}${search}
    ORDER  BY nb.first_bill DESC, nb.customer_id
    LIMIT  ${pageSize} OFFSET ${(page - 1) * pageSize}`);
  const total = Number(rows[0]?.total ?? 0);
  return {
    rows: rows.map((row) => ({
      customerId: Number(row.customer_id),
      customerCode: (row.customer_code as string | null) ?? null,
      name: (row.full_name as string | null) ?? null,
      phone: String(row.phone_e164 ?? ''),
      segment: row.segment as NewCustomerSegment,
      source: (row.source as string | null) ?? null,
      firstBill: String(row.first_bill ?? ''),
      lastBill: String(row.last_bill ?? ''),
      store: (row.store as string | null) ?? null,
      bills: Number(row.bills ?? 0),
      sales: Number(row.sales ?? 0),
    })),
    total,
    page,
    pageSize,
    pageCount: Math.max(Math.ceil(total / pageSize), 1),
  };
}

/**
 * Every bill in the period in exactly one group, so the groups add up to Total
 * sales: loyalty-list customers first, then foreign numbers, then the three
 * new-customer groups, then bills with no phone number (no customer at all).
 */
export const SALES_SOURCES = ['loyalty', 'lead', 'walkin', 'other', 'foreign', 'no_phone'] as const;
export type SalesSource = (typeof SALES_SOURCES)[number];

export const SALES_SOURCE_INFO: Record<SalesSource, { label: string; definition: string; segment?: NewCustomerSegment }> = {
  loyalty: { label: 'Loyalty customers', definition: 'On the loyalty customer sheet: they had bought before.' },
  lead: { label: 'New: from lead sheets', definition: NEW_CUSTOMER_SEGMENT_INFO.lead.definition, segment: 'lead' },
  walkin: { label: 'New: walk-ins', definition: NEW_CUSTOMER_SEGMENT_INFO.walkin.definition, segment: 'walkin' },
  other: { label: 'New: other buyers', definition: NEW_CUSTOMER_SEGMENT_INFO.other.definition, segment: 'other' },
  foreign: { label: 'Foreign numbers', definition: 'A non-Indian phone number, not on the loyalty sheet.' },
  no_phone: { label: 'No phone number', definition: 'No number taken at billing, so the bill belongs to no customer.' },
};

export type SalesSourceRow = { source: SalesSource; customers: number; bills: number; sales: number };
export type SalesBySource = { rows: SalesSourceRow[]; total: Omit<SalesSourceRow, 'source'> };

export async function getSalesBySource(range: DateRange = {}): Promise<SalesBySource> {
  const rows = await query(`
    WITH billed AS (
      SELECT s.customer_id, s.bill_amount,
             CASE
               WHEN s.customer_id IS NULL THEN 'no_phone'
               WHEN EXISTS (SELECT 1 FROM loyalty_customers lc WHERE lc.customer_id = s.customer_id) THEN 'loyalty'
               WHEN c.is_foreign THEN 'foreign'
               ELSE ${segmentCase('s')}
             END AS source
      FROM   sales s
      LEFT   JOIN customers c ON c.id = s.customer_id
      WHERE  true${scopeCondition('s', range)}
    )
    SELECT source, COUNT(DISTINCT customer_id)::int AS customers, COUNT(*)::int AS bills,
           COALESCE(SUM(bill_amount), 0)::float8 AS sales
    FROM   billed
    GROUP  BY ROLLUP (source)`);
  const byKey = new Map(rows.map((row) => [row.source as string | null, row]));
  const read = (row: Row | undefined) => ({
    customers: Number(row?.customers ?? 0),
    bills: Number(row?.bills ?? 0),
    sales: Number(row?.sales ?? 0),
  });
  return {
    rows: SALES_SOURCES.map((source) => ({ source, ...read(byKey.get(source)) })),
    total: read(byKey.get(null)),
  };
}
