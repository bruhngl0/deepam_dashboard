/**
 * Import — load a new master workbook.
 *
 * A Server Component only for the one thing that must never reach the
 * browser as a live check: whether committing is enabled. `ALLOW_MASTER_SHEET_IMPORT`
 * is read here and passed down as a plain boolean; the actual enforcement
 * lives server-side again in `commit/route.ts`, so a client that somehow
 * rendered the button anyway still can't make the request succeed (D-89).
 *
 * `requireUser()` is on this page for the same reason it's on the other two —
 * the proxy redirect is not the boundary — and matters more here than
 * anywhere else in the app: this is the one page that can delete data.
 */

import { BulkLeadsImportForm } from '@/components/bulk-leads-import-form';
import { ImportForm } from '@/components/import-form';
import { InstagramLeadsImportForm } from '@/components/instagram-leads-import-form';
import { SalesImportForm } from '@/components/sales-import-form';
import { requireUser } from '@/lib/auth';

export default async function ImportPage() {
  await requireUser();

  const commitEnabled = process.env.ALLOW_MASTER_SHEET_IMPORT === 'true';

  return (
    <main className="mx-auto w-full max-w-[92rem] px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Import</h1>
        <p className="mt-1 max-w-[68ch] text-sm text-ink-2">
          Drop your files below and hit Submit, or use one of the single-file paths further down.
          Every path previews first; nothing is written until you confirm.
        </p>
      </header>

      <div className="flex flex-col gap-6">
        <section className="card rounded-2xl border border-line bg-surface p-6">
          <h2 className="text-lg font-semibold tracking-tight text-ink">Bulk import</h2>
          <p className="mt-1 max-w-[68ch] text-sm text-ink-2">
            Drag in whichever lead sheets you have — Meta, WhatsApp, Google Ads, Others — plus a
            sales report if you&rsquo;ve got one, then press Submit once. Additive only: new leads
            are added under each channel&rsquo;s campaign, a phone number already on file is skipped
            automatically, and nothing existing is ever replaced.
          </p>
          <div className="mt-4">
            <BulkLeadsImportForm />
          </div>
        </section>

        <section className="card rounded-2xl border border-line bg-surface p-6">
          <h2 className="text-lg font-semibold tracking-tight text-ink">Sales report</h2>
          <p className="mt-1 max-w-[68ch] text-sm text-ink-2">
            A POS export for one billing period. Additive and idempotent (D-04, D-59) — becomes
            its own selectable report on the Analysis page, existing reports are never touched.
          </p>
          <div className="mt-4">
            <SalesImportForm />
          </div>
        </section>

        <section className="card rounded-2xl border border-line bg-surface p-6">
          <h2 className="text-lg font-semibold tracking-tight text-ink">Instagram / Meta leads</h2>
          <p className="mt-1 max-w-[68ch] text-sm text-ink-2">
            A per-campaign Meta export (one sheet per campaign — the original lead-form shape,
            D-08). Adds new phone numbers under the existing Master Sheet — Meta campaign;
            WhatsApp, Google Ads and Others are never touched.
          </p>
          <div className="mt-4">
            <InstagramLeadsImportForm />
          </div>
        </section>

        <section className="card rounded-2xl border border-line bg-surface p-6">
          <h2 className="text-lg font-semibold tracking-tight text-ink">Master workbook</h2>
          <p className="mt-1 max-w-[68ch] text-sm text-ink-2">
            The cleaned combined workbook (D-84) — one sheet per channel: Meta, WhatsApp, Google
            Ads, Others. Unlike the two forms above, committing this <strong>replaces the
            entire lead layer</strong> — see the warning below before using it.
          </p>
          <div className="mt-4">
            <ImportForm commitEnabled={commitEnabled} />
          </div>
        </section>
      </div>
    </main>
  );
}
