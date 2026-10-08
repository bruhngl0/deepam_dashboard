/**
 * Vendor import — load a vendor stock ledger. It upserts on a natural key
 * (D-64) rather than replacing anything, so unlike `/crm/import`'s master
 * workbook there's no `ALLOW_*` gate to read here. Barcode-wise sales are no
 * longer uploaded here: they arrive from Hemparshwa OS (lib/integration/hemparshwa.ts).
 *
 * `requireUser()` for the same reason it's on every other page — the proxy
 * redirect is not the boundary.
 */

import { VendorStockImportForm } from '@/components/vendor-stock-import-form';
import { requireUser } from '@/lib/auth';

export default async function VendorImportPage() {
  await requireUser();

  return (
    <main className="mx-auto w-full max-w-[92rem] px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Vendor import</h1>
        <p className="mt-1 max-w-[68ch] text-sm text-ink-2">
          The file previews first; nothing is written until you confirm. It doesn&rsquo;t replace
          anything already loaded — a corrected re-export just upserts its own rows. Barcode-wise
          sales are imported in Hemparshwa OS and arrive here on their own.
        </p>
      </header>

      <div className="flex flex-col gap-6">
        <section className="card rounded-2xl border border-line bg-surface p-6">
          <h2 className="text-lg font-semibold tracking-tight text-ink">Vendor stock ledger</h2>
          <p className="mt-1 max-w-[68ch] text-sm text-ink-2">
            A purchase-to-closing-stock snapshot per barcode, per vendor, for one reporting
            period (e.g. &ldquo;Party Wise.xlsx&rdquo;).
          </p>
          <div className="mt-4">
            <VendorStockImportForm />
          </div>
        </section>
      </div>
    </main>
  );
}
