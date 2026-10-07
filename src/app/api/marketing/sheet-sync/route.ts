/**
 * Connect, list and run the live Google Sheet import for Marketing
 * Intelligence. The scheduled trigger lives in `./cron`.
 */

import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { parseSpreadsheetId, readWorkbook, serviceAccount, SheetError } from '@/lib/marketing/google-sheets';
import { collectRows, getSheetConfig, getSyncStatus, MAX_SHEETS, parseConfig, runSheetSync, saveSheetConfig, schedulerRunning, syncIntervalMinutes } from '@/lib/marketing/sheet-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function overview() {
  let serviceEmail = ''; let keyError = '';
  try { serviceEmail = serviceAccount()?.client_email ?? ''; } catch (error) { keyError = (error as Error).message; }
  const [config, { status, checkedAt }] = await Promise.all([getSheetConfig(true), getSyncStatus()]);
  return { serviceEmail, keyError, sheets: config?.sheets ?? [], status, checkedAt, intervalMinutes: schedulerRunning() ? syncIntervalMinutes() : 0 };
}

export async function GET() {
  const auth = await requireApiUser();
  if (auth instanceof Response) return auth;
  return NextResponse.json(await overview());
}

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (auth instanceof Response) return auth;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const sheets = (await getSheetConfig(true))?.sheets ?? [];
  try {
    if (body?.action === 'add') {
      const spreadsheetId = parseSpreadsheetId(String(body.url ?? ''));
      if (!spreadsheetId) return NextResponse.json({ error: 'Paste the Google Sheets link from your browser address bar.' }, { status: 422 });
      if (sheets.some((s) => s.spreadsheetId === spreadsheetId)) return NextResponse.json({ error: 'That sheet is already connected.' }, { status: 422 });
      if (sheets.length >= MAX_SHEETS) return NextResponse.json({ error: `At most ${MAX_SHEETS} sheets can be connected.` }, { status: 422 });
      const workbook = await readWorkbook(spreadsheetId);
      const added = parseConfig({ sheets: [{ spreadsheetId, title: workbook.title, defaultSource: body.defaultSource }] })!.sheets[0];
      const found = collectRows(added, workbook);
      if (!found.tabs.length) return NextResponse.json({ error: found.problems[0] ? `${found.problems[0].where}: ${found.problems[0].reason}` : 'No lead tab found in that sheet. A lead tab needs a row of headings that includes a contact number and a name.' }, { status: 422 });
      await saveSheetConfig({ sheets: [...sheets, added] });
      await runSheetSync(true);
      return NextResponse.json(await overview());
    }
    if (body?.action === 'remove') {
      const rest = sheets.filter((s) => s.spreadsheetId !== body.spreadsheetId);
      await saveSheetConfig(rest.length ? { sheets: rest } : null);
      if (rest.length) await runSheetSync(true);
      return NextResponse.json(await overview());
    }
    if (body?.action === 'sync') {
      await runSheetSync(true);
      return NextResponse.json(await overview());
    }
  } catch (error) {
    // A SheetError is for the person at the screen; anything else is a real fault.
    if (error instanceof SheetError) return NextResponse.json({ error: error.message }, { status: 422 });
    throw error;
  }
  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
}
