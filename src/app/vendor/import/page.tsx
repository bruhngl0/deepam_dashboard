/**
 * Vendor import — load a vendor stock ledger or a barcode-wise sales
 * register. Both paths upsert on a natural key (D-64) rather than replacing
 * anything, so unlike `/crm/import`'s master workbook there's no `ALLOW_*`
 * gate to read here.
 *
 * `requireUser()` for the same reason it's on every other page — the proxy
 * redirect is not the boundary.
 */

import { VendorStockImportForm } from '@/components/vendor-stock-import-form';
import { SaleLineItemsImportForm } from '@/components/sale-line-items-import-form';
import { requireUser } from '@/lib/auth';

export default async function VendorImportPage() {
  await requireUser();

  return (
    <main className="mx-auto w-full max-w-[92rem] px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Vendor import</h1>
        <p className="mt-1 max-w-[68ch] text-sm text-ink-2">
          Both files preview first; nothing is written until you confirm. Neither replaces
          anything already loaded — a corrected re-export just upserts its own rows.
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

        <section className="card rounded-2xl border border-line bg-surface p-6">
          <h2 className="text-lg font-semibold tracking-tight text-ink">Barcode-wise sales</h2>
          <p className="mt-1 max-w-[68ch] text-sm text-ink-2">
            Item-level detail per bill. Links back to an existing bill in the CRM&rsquo;s sales
            table where a match is found, by voucher date and number — bills themselves are
            never replaced.
          </p>
          <div className="mt-4">
            <SaleLineItemsImportForm />
          </div>
        </section>
      </div>
    </main>
  );
}
