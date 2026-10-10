/**
 * Live Google Sheets → marketing leads.
 *
 * One run reads every tab of every connected spreadsheet, keeps the tabs that
 * are lead lists, and pushes their rows through the same `previewRows` rules
 * as a file upload. Only leads that are new or gained something are written,
 * so running it again on unchanged sheets writes nothing and it is safe to
 * trigger from a timer, a cron request and a button at once.
 *
 * Columns are matched by heading on every run rather than stored, because a
 * tracker gets a new tab each month and the tabs do not share one layout.
 *
 * The connections and the last result live in `settings`. A run that finds
 * the sheets unchanged since this process last imported them stops before
 * touching the database.
 */

import { createHash } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { settings } from '@/db/schema';
import { normalizePhone } from '@/lib/phone';
import { EMPTY, nowLocal, previewRows, SOURCES } from './local';
import { readWorkbook, SheetError, type Workbook } from './google-sheets';
import { routeActive, routeForTab, routeSheetLead } from './sheet-routing';
import { CANONICAL, tabRows } from './sheet-rows';
import { loadDataset, saveChanges } from './store';
import { syncMarketingLeadsToCrm } from './crm-sync';

const CONFIG_KEY = 'marketing_sheet_sync';
const STATUS_KEY = 'marketing_sheet_sync_status';
const CONFIG_TTL_MS = 15 * 60_000;
const MAX_REPORTED_ROWS = 50;
export const MAX_SHEETS = 10;

/** `defaultSource` is used for rows whose source cell is blank, or when a tab has no source column. */
export type SheetSource = { spreadsheetId: string; title: string; defaultSource: string };
export type SheetConfig = { sheets: SheetSource[] };
export type TabSummary = { sheet: string; tab: string; rows: number };
export type SyncStatus = {
  at: string; ok: boolean; error: string;
  rows: number; added: number; updated: number; duplicates: number; conflicts: number;
  crmCustomers: number; crmTouches: number;
  tabs: TabSummary[]; invalidCount: number; invalid: { where: string; row: number; reason: string }[];
};
export type SyncOutcome = { state: 'off' | 'unchanged' | 'synced' | 'failed'; status: SyncStatus | null };

type State = {
  config: { value: SheetConfig | null; at: number } | null;
  hash: string | null; checkedAt: string | null; lastError: string | null;
  running: Promise<SyncOutcome> | null; timer: ReturnType<typeof setInterval> | null;
};
// On globalThis because the scheduler and the route handlers can be bundled as separate module instances.
const holder = globalThis as typeof globalThis & { __marketingSheetSync?: State };
const state = holder.__marketingSheetSync ??= { config: null, hash: null, checkedAt: null, lastError: null, running: null, timer: null };

export function parseConfig(value: unknown): SheetConfig | null {
  const sheets = (value as Partial<SheetConfig> | null)?.sheets;
  if (!Array.isArray(sheets)) return null;
  const seen = new Set<string>();
  const valid = sheets.flatMap((v: Partial<SheetSource> | null): SheetSource[] => {
    if (!v || typeof v.spreadsheetId !== 'string' || !/^[\w-]{20,}$/.test(v.spreadsheetId) || seen.has(v.spreadsheetId)) return [];
    seen.add(v.spreadsheetId);
    return [{ spreadsheetId: v.spreadsheetId, title: typeof v.title === 'string' ? v.title.slice(0, 200) : '', defaultSource: (SOURCES as readonly string[]).includes(v.defaultSource ?? '') ? v.defaultSource! : '' }];
  });
  return valid.length ? { sheets: valid.slice(0, MAX_SHEETS) } : null;
}

type Collected = { rows: Record<string, unknown>[]; origin: { where: string; tab: string; row: number }[]; tabs: TabSummary[]; problems: SyncStatus['invalid'] };
const filled = (row: Record<string, unknown>) => Object.values(row).some((v) => String(v).trim() !== '');

/** The lead tabs of one workbook as canonical rows, remembering which tab and sheet row each came from. */
export function collectRows(source: SheetSource, workbook: Workbook, into: Collected = { rows: [], origin: [], tabs: [], problems: [] }): Collected {
  const sheet = source.title || workbook.title || 'Google Sheet';
  for (const { name, grid } of workbook.tabs) {
    let tab: ReturnType<typeof tabRows>;
    try { tab = tabRows(grid, source.defaultSource); }
    catch (error) { into.problems.push({ where: `${sheet} · ${name}`, row: 0, reason: (error as Error).message }); continue; }
    if (!tab) continue;
    const count = tab.rows.filter(filled).length;
    if (!count) continue;
    into.tabs.push({ sheet, tab: name, rows: count });
    tab.rows.forEach((row, i) => { into.rows.push(row); into.origin.push({ where: `${sheet} · ${name}`, tab: name, row: tab.first + i }); });
  }
  return into;
}

async function readSetting(key: string): Promise<unknown> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, key)).limit(1);
  return row?.value ?? null;
}
async function writeSetting(key: string, value: unknown, description: string) {
  await db.insert(settings).values({ key, value, description }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: sql`now()` } });
}

export async function getSheetConfig(fresh = false): Promise<SheetConfig | null> {
  if (!fresh && state.config && Date.now() - state.config.at < CONFIG_TTL_MS) return state.config.value;
  const value = parseConfig(await readSetting(CONFIG_KEY));
  state.config = { value, at: Date.now() };
  return value;
}

export async function saveSheetConfig(config: SheetConfig | null) {
  if (config) await writeSetting(CONFIG_KEY, config, 'Google Sheet that Marketing Intelligence imports leads from.');
  else await db.delete(settings).where(eq(settings.key, CONFIG_KEY));
  state.config = { value: config, at: Date.now() };
  state.hash = null; state.lastError = null;
}

export async function getSyncStatus(): Promise<{ status: SyncStatus | null; checkedAt: string | null }> {
  const status = await readSetting(STATUS_KEY) as SyncStatus | null;
  return { status, checkedAt: state.checkedAt && (!status || state.checkedAt > status.at) ? state.checkedAt : status?.at ?? null };
}

export function syncIntervalMinutes(): number {
  const raw = process.env.MARKETING_SHEET_SYNC_MINUTES;
  const minutes = raw === undefined || raw.trim() === '' ? 5 : Number(raw);
  return Number.isFinite(minutes) && minutes >= 0 ? Math.floor(minutes) : 5;
}

async function sync(force: boolean): Promise<SyncOutcome> {
  const config = await getSheetConfig(force);
  if (!config) return { state: 'off', status: null };
  const at = new Date().toISOString();
  const status: SyncStatus = { at, ok: true, error: '', rows: 0, added: 0, updated: 0, duplicates: 0, conflicts: 0, crmCustomers: 0, crmTouches: 0, tabs: [], invalidCount: 0, invalid: [] };
  try {
    const workbooks = await Promise.all(config.sheets.map((source) => readWorkbook(source.spreadsheetId).catch((error: unknown) => {
      throw error instanceof SheetError ? new SheetError(`${source.title || 'Google Sheet'}: ${error.message}`) : error;
    })));
    const hash = createHash('sha1').update(JSON.stringify([config, workbooks])).digest('hex');
    state.checkedAt = at;
    if (!force && hash === state.hash) return { state: 'unchanged', status: null };

    const collected = config.sheets.reduce((into, source, i) => collectRows(source, workbooks[i], into), undefined as Collected | undefined)!;
    if (!collected.tabs.length && !collected.problems.length) throw new Error('No lead tab found. A lead tab needs a row of headings that includes a contact number and a name.');
    const { data, versions } = await loadDataset();
    const preview = previewRows(collected.rows, 'leads', CANONICAL, data);
    const changed = new Map(preview.leads.map((lead) => [lead.phone, lead]));
    const existing = new Map(data.leads.map((lead) => [lead.phone, lead]));
    const claimedAt = nowLocal();
    collected.rows.forEach((row, index) => {
      const tab = collected.origin[index]?.tab ?? '';
      const route = routeForTab(tab);
      if (!route) return;
      const phone = normalizePhone(row.phone);
      if (!phone.ok || phone.hadMultiple) return;
      const lead = changed.get(phone.e164) ?? existing.get(phone.e164);
      if (!lead) return;
      const routed = routeSheetLead(lead, tab, route, claimedAt, routeActive(route, claimedAt.slice(0, 10)));
      if (JSON.stringify(routed) !== JSON.stringify(lead)) changed.set(phone.e164, routed);
    });
    const saved = await saveChanges([...changed.values()].map((lead) => ({ lead, version: versions[lead.id] ?? 0 })), []);
    // Build the complete valid population independently of Marketing
    // Intelligence's change detection. If a prior CRM write failed after the
    // marketing rows committed, the next run can still repair the CRM side.
    const crmPopulation = previewRows(collected.rows, 'leads', CANONICAL, EMPTY).leads;
    const crm = await syncMarketingLeadsToCrm(crmPopulation);

    // previewRows numbers rows as if they were one sheet with a header in row 1; map each back to its own tab and row.
    const invalid = [...collected.problems, ...preview.errors.map((e) => ({ ...collected.origin[e.row - 2], reason: e.reason }))];
    status.rows = collected.tabs.reduce((n, t) => n + t.rows, 0); status.tabs = collected.tabs;
    status.added = saved.inserted; status.updated = saved.updated; status.duplicates = preview.duplicates; status.conflicts = saved.conflicts.length;
    status.crmCustomers = crm.customersUpserted; status.crmTouches = crm.touchesInserted;
    status.invalidCount = invalid.length; status.invalid = invalid.slice(0, MAX_REPORTED_ROWS);
    // A lead someone was editing at that moment is skipped; keep the hash unset so the next run retries it.
    state.hash = saved.conflicts.length ? null : hash;
    state.lastError = null;
  } catch (error) {
    status.ok = false;
    status.error = error instanceof Error ? error.message : 'Sync failed.';
    state.hash = null;
    // The same failure every few minutes is one piece of news, not a write per run.
    if (!force && state.lastError === status.error) return { state: 'failed', status };
    state.lastError = status.error;
  }
  await writeSetting(STATUS_KEY, status, 'Result of the last Marketing Intelligence Google Sheet sync.');
  return { state: status.ok ? 'synced' : 'failed', status };
}

export const schedulerRunning = () => state.timer !== null;

/** `force` re-reads the connection and imports even if the sheet looks unchanged. */
export function runSheetSync(force = false): Promise<SyncOutcome> {
  return state.running ??= sync(force).finally(() => { state.running = null; });
}

/** In-process timer for long-running Node hosts. Serverless hosts call the cron route instead. */
export function startSheetSyncScheduler() {
  const minutes = syncIntervalMinutes();
  if (!minutes || state.timer) return;
  const tick = () => { runSheetSync().catch((error) => console.error('[marketing sheet sync]', error)); };
  setTimeout(tick, 15_000).unref();
  state.timer = setInterval(tick, minutes * 60_000);
  state.timer.unref();
}
