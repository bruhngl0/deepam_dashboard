/**
 * Barcode-wise sales import — preview.
 *
 * Additive/upserting, not destructive — same reasoning as the vendor stock
 * ledger's preview route. No ALLOW_* kill-switch.
 */

import { previewSaleLineItemsImport } from '@/lib/import/sale-line-items';
import { requireApiUser } from '@/lib/auth';

export const runtime = 'nodejs';

export interface SaleLineItemsPreviewResponse {
  fileName: string;
  sheetName: string;
  bannerText: string | null;
  linesTotal: number;
  netQty: number;
  grossSalesAmt: number;
  uniqueVouchers: number;
  uniqueBarcodes: number;
  negativeQtyLines: number;
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
    const preview = await previewSaleLineItemsImport(buffer, file.name);

    const rejectedByCode = new Map<string, number>();
    for (const r of preview.rejected) {
      rejectedByCode.set(r.errorCode, (rejectedByCode.get(r.errorCode) ?? 0) + 1);
    }

    const body: SaleLineItemsPreviewResponse = {
      fileName: preview.fileName,
      sheetName: preview.sheetName,
      bannerText: preview.bannerText,
      linesTotal: preview.summary.linesTotal,
      netQty: preview.summary.netQty,
      grossSalesAmt: preview.summary.grossSalesAmt,
      uniqueVouchers: preview.summary.uniqueVouchers,
      uniqueBarcodes: preview.summary.uniqueBarcodes,
      negativeQtyLines: preview.summary.negativeQtyLines,
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
