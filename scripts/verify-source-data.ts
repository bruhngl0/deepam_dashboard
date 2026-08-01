/**
 * Regression harness for the ingestion layer.
 *
 * Runs lib/phone.ts against the four real source files and checks the output
 * against the figures recorded in DECISIONS.md appendix Q. If the phone module
 * changes and these numbers move, something broke.
 *
 *   npx tsx scripts/verify-source-data.ts [path-to-downloads-dir]
 */

import * as XLSX from 'xlsx';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizePhone } from '../src/lib/phone';

const DIR = process.argv[2] ?? join(process.env.HOME ?? '', 'Downloads');

const FILES = {
  meta: 'Deepam Varamahalakshmi - Leads Mastersheet.xlsx',
  whatsapp: 'Whatsapp Campaign Delivered Numbers.xlsx',
  walkin: 'onboarding_submissions.xlsx',
  sales: 'MG, JAYANAGAR_Sales Report.xlsx',
} as const;


function sheetRows(path: string, sheetName?: string): { name: string; rows: unknown[][] }[] {
  const wb = XLSX.read(readFileSync(path), { type: 'buffer', cellDates: true });
  const names = sheetName ? [sheetName] : wb.SheetNames;
  return names.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], {
      header: 1,
      raw: true,
      defval: null,
    }),
  }));
}

function headerIndex(header: unknown[], needle: string): number {
  return header.findIndex((h) =>
    String(h ?? '').toLowerCase().replace(/[\s_]/g, '').includes(needle),
  );
}

let failures = 0;

function check(label: string, actual: number, expected: number) {
  const pass = actual === expected;
  if (!pass) failures++;
  console.log(
    `  ${pass ? '✓' : '✗'} ${label.padEnd(34)} ${String(actual).padStart(14)}` +
      (pass ? '' : `   expected ${expected}`),
  );
}

console.log('\nVerifying lib/phone.ts against the real source files\n');

// ── META ────────────────────────────────────────────────────────────────────
const metaPhones = new Set<string>();
let metaRows = 0;
let metaRejects = 0;
for (const { rows } of sheetRows(join(DIR, FILES.meta))) {
  if (!rows.length) continue;
  const pi = headerIndex(rows[0], 'phone');
  if (pi < 0) continue;
  for (const row of rows.slice(1)) {
    if (!row || row.every((v) => v === null || v === '')) continue;
    metaRows++;
    const r = normalizePhone(row[pi]);
    if (r.ok) metaPhones.add(r.e164);
    else if (r.reason !== 'empty') metaRejects++;
  }
}

// ── WHATSAPP ────────────────────────────────────────────────────────────────
const waPhones = new Set<string>();
let waRows = 0;
let waRejects = 0;
for (const row of sheetRows(join(DIR, FILES.whatsapp), 'Sheet1')[0].rows) {
  if (!row || row[0] === null || row[0] === '') continue;
  waRows++;
  const r = normalizePhone(row[0]);
  if (r.ok) waPhones.add(r.e164);
  else if (r.reason !== 'empty') waRejects++;
}

// ── WALK-IN ─────────────────────────────────────────────────────────────────
const walkPhones = new Set<string>();
/** Walk-in visitors who ticked "Existing Customer" on the form. (D-35) */
const declaredExisting = new Set<string>();
let walkRows = 0;
{
  const { rows } = sheetRows(join(DIR, FILES.walkin))[0];
  const pi = headerIndex(rows[0], 'contactnumber');
  const hi = headerIndex(rows[0], 'howdidyouhear');
  for (const row of rows.slice(1)) {
    if (!row || row.every((v) => v === null || v === '')) continue;
    walkRows++;
    const r = normalizePhone(row[pi]);
    if (!r.ok) continue;
    walkPhones.add(r.e164);
    if (String(row[hi] ?? '').trim() === 'Existing Customer') {
      declaredExisting.add(r.e164);
    }
  }
}

// ── SALES ───────────────────────────────────────────────────────────────────
const salePhones = new Set<string>();
const revenueByPhone = new Map<string, number>();
let bills = 0;
let gross = 0;
let phoneless = 0;
let phonelessRevenue = 0;
const byPrefix = new Map<string, { bills: number; revenue: number }>();
{
  const { rows } = sheetRows(join(DIR, FILES.sales))[0];
  for (const row of rows) {
    const voucher = String(row?.[1] ?? '');
    // Skips the 3-row banner, the header, and the trailing totals row (D-11).
    if (!voucher.startsWith('BK')) continue;
    bills++;
    const amount = Number(row[6] ?? 0);
    gross += amount;

    const prefix = voucher.slice(0, 5);
    const agg = byPrefix.get(prefix) ?? { bills: 0, revenue: 0 };
    agg.bills++;
    agg.revenue += amount;
    byPrefix.set(prefix, agg);

    const r = normalizePhone(row[4]);
    if (r.ok) {
      salePhones.add(r.e164);
      revenueByPhone.set(r.e164, (revenueByPhone.get(r.e164) ?? 0) + amount);
    } else {
      phoneless++;
      phonelessRevenue += amount;
    }
  }
}

// ── Cross-source figures ────────────────────────────────────────────────────
const allLeads = new Set([...metaPhones, ...waPhones, ...walkPhones]);
const converted = [...allLeads].filter((p) => salePhones.has(p));
const unmatchedBuyers = [...salePhones].filter((p) => !allLeads.has(p));
const existingInferredRevenue = unmatchedBuyers.reduce(
  (s, p) => s + (revenueByPhone.get(p) ?? 0),
  0,
);

console.log('SOURCE COUNTS');
check('meta data rows (5 sheets)', metaRows, 2020);
check('meta unique phones', metaPhones.size, 1736);
check('meta rejected rows', metaRejects, 26);
check('whatsapp rows', waRows, 6962);
check('whatsapp unique phones', waPhones.size, 3696);
check('whatsapp rejected rows', waRejects, 12);
check('walkin rows', walkRows, 820);
check('walkin unique phones', walkPhones.size, 741);

console.log('\nSALES');
check('bills', bills, 847);
check('gross revenue', Math.round(gross), 20103733);
check('unique sale phones', salePhones.size, 650);
check('bills without phone', phoneless, 66);
check('revenue without phone', Math.round(phonelessRevenue), 1716361);
for (const [prefix, agg] of [...byPrefix].sort()) {
  const store = prefix === 'BK01-' ? 'MG Road' : 'Jayanagar';
  console.log(
    `    ${prefix} ${store.padEnd(10)} ${String(agg.bills).padStart(4)} bills   ` +
      `Rs ${Math.round(agg.revenue).toLocaleString('en-IN')}`,
  );
}

console.log('\nCROSS-SOURCE');
check('union of all leads', allLeads.size, 5866);
check('leads with a sale', converted.length, 366);
check('buyers with no lead record', unmatchedBuyers.length, 284);
check('their revenue (existing)', Math.round(existingInferredRevenue), 7920018);

// Attribution is deliberately NOT recomputed here.
//
// It used to be, with a simplified priority-only rule, and that second
// implementation drifted from the real one in the database — it ignored
// campaign start dates and mis-assigned two customers between Meta and
// WhatsApp. One definition per metric (D-76): `scripts/verify-metrics.ts`
// checks attribution against the actual materialized view.

console.log('\nINVARIANTS');
check(
  'phone-less + attributable = gross',
  Math.round(phonelessRevenue + [...revenueByPhone.values()].reduce((a, b) => a + b, 0)),
  Math.round(gross),
);

console.log(
  `\n${failures === 0 ? '✓ ALL CHECKS PASSED' : `✗ ${failures} CHECK(S) FAILED`}\n`,
);
process.exit(failures === 0 ? 0 : 1);
