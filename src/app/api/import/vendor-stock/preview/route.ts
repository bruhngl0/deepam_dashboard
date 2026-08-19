/**
 * Vendor stock ledger import — preview.
 *
 * Additive/upserting, not destructive — re-uploading the same reporting
 * period corrects that period's figures rather than duplicating them, so
 * there's no ALLOW_* kill-switch here (same reasoning as sales' preview
 * route).
 */

import { previewVendorStockImport } from '@/lib/import/vendor-stock';
import { requireApiUser } from '@/lib/auth';

export const runtime = 'nodejs';

export interface VendorStockPreviewResponse {
  fileName: string;
  sheetName: string;
  bannerText: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  rowsTotal: number;
  purchaseAmount: number;
  netSalesAmount: number;
  closingAmount: number;
  uniqueVendors: number;
  uniqueBarcodes: number;
  duplicateRowsInFile: number;
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
    const preview = await previewVendorStockImport(buffer, file.name);

    const rejectedByCode = new Map<string, number>();
    for (const r of preview.rejected) {
      rejectedByCode.set(r.errorCode, (rejectedByCode.get(r.errorCode) ?? 0) + 1);
    }

    const body: VendorStockPreviewResponse = {
      fileName: preview.fileName,
      sheetName: preview.sheetName,
      bannerText: preview.bannerText,
      periodFrom: preview.summary.periodFrom,
      periodTo: preview.summary.periodTo,
      rowsTotal: preview.summary.rowsTotal,
      purchaseAmount: preview.summary.purchaseAmount,
      netSalesAmount: preview.summary.netSalesAmount,
      closingAmount: preview.summary.closingAmount,
      uniqueVendors: preview.summary.uniqueVendors,
      uniqueBarcodes: preview.summary.uniqueBarcodes,
      duplicateRowsInFile: preview.summary.duplicateRowsInFile,
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
