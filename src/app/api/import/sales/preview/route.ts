/**
 * Sales report import — preview.
 *
 * Additive, not destructive (D-04: sales are appended, never replaced or
 * merged), and idempotent on `voucher_no` (D-59) — re-uploading the same
 * report twice is a harmless no-op, so there's no ALLOW_* kill-switch here
 * the way master-sheet's commit route has one.
 *
 * The response carries summary figures only, never `preview.parsed.rows` —
 * those hold every customer name and phone number in the file.
 */

import { previewSalesImport } from '@/lib/import/sales';
import { requireApiUser } from '@/lib/auth';

export const runtime = 'nodejs';

export interface SalesPreviewResponse {
  fileName: string;
  sheetName: string;
  bannerText: string | null;
  billsTotal: number;
  grossRevenue: number;
  uniquePhones: number;
  withPhone: number;
  withoutPhone: number;
  revenueWithoutPhone: number;
  dateRange: { from: string; to: string } | null;
  storeBreakdown: { store: string; prefix: string; bills: number; revenue: number }[];
  unknownPrefixes: string[];
  duplicateVouchersInFile: number;
  alreadyImported: boolean;
  rejectedByCode: { code: string; n: number }[];
}

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (auth instanceof Response) return auth;

  const form = await request.formData();
  const file = form.get('file');

  if (!(file instanceof File)) {
    return Response.json({ error: 'No file uploaded.' }, { status: 400 });
  }
  if (!file.name.match(/\.xlsx?$/i)) {
    return Response.json({ error: 'Expected an .xlsx or .xls workbook.' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const preview = await previewSalesImport(buffer, file.name);

    const rejectedByCode = new Map<string, number>();
    for (const r of preview.rejected) {
      rejectedByCode.set(r.errorCode, (rejectedByCode.get(r.errorCode) ?? 0) + 1);
    }

    const body: SalesPreviewResponse = {
      fileName: preview.fileName,
      sheetName: preview.sheetName,
      bannerText: preview.bannerText,
      billsTotal: preview.summary.billsTotal,
      grossRevenue: preview.summary.grossRevenue,
      uniquePhones: preview.summary.uniquePhones,
      withPhone: preview.summary.withPhone,
      withoutPhone: preview.summary.withoutPhone,
      revenueWithoutPhone: preview.summary.revenueWithoutPhone,
      dateRange: preview.summary.dateRange,
      storeBreakdown: preview.summary.storeBreakdown,
      unknownPrefixes: preview.summary.unknownPrefixes,
      duplicateVouchersInFile: preview.summary.duplicateVouchersInFile,
      alreadyImported: preview.summary.alreadyImported,
      rejectedByCode: [...rejectedByCode.entries()]
        .map(([code, n]) => ({ code, n }))
        .sort((a, b) => b.n - a.n),
    };
    return Response.json(body);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'Could not parse the workbook.' },
      { status: 422 },
    );
  }
}
