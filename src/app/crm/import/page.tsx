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
import { ExistingCustomersImportForm } from '@/components/existing-customers-import-form';
import { HemparshwaSyncPanel } from '@/components/hemparshwa-sync-panel';
import { syncIntervalHours } from '@/lib/integration/hemparshwa-schedule';
import { getHemparshwaCopy } from '@/lib/integration/hemparshwa-status';
import { requireUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function ImportPage() {
  await requireUser();

  const commitEnabled = process.env.ALLOW_MASTER_SHEET_IMPORT === 'true';
  const hemparshwa = await getHemparshwaCopy();

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
          <h2 className="text-lg font-semibold tracking-tight text-ink">Sales from Hemparshwa OS</h2>
          <p className="mt-1 max-w-[68ch] text-sm text-ink-2">
            Sales are imported in Hemparshwa OS (the Barcode Wise file) and pulled in here on their
            own. Press Sync now to pull a new import straight away.
          </p>
          <div className="mt-4">
            <HemparshwaSyncPanel copy={hemparshwa} everyHours={syncIntervalHours()} />
          </div>
        </section>

        <section className="card rounded-2xl border border-line bg-surface p-6">
          <h2 className="text-lg font-semibold tracking-tight text-ink">Existing customers</h2>
          <p className="mt-1 max-w-[68ch] text-sm text-ink-2">
            A loyalty/CRM customer master (Capillary-style export). Run this <strong>first</strong>,
            before any lead import — it seeds lifecycle = existing for everyone in it, so
            later imports never mistake a known customer for a new acquisition.
          </p>
          <div className="mt-4">
            <ExistingCustomersImportForm />
          </div>
        </section>

        <section className="card rounded-2xl border border-line bg-surface p-6">
          <h2 className="text-lg font-semibold tracking-tight text-ink">Bulk import</h2>
          <p className="mt-1 max-w-[68ch] text-sm text-ink-2">
            Drag in whichever lead sheets you have — Meta, WhatsApp, Google Ads, Others — then
            press Submit once. Sales are imported in Hemparshwa OS and arrive here on their own.
            Additive only: new leads
            are added under each channel&rsquo;s campaign, a phone number already on file is skipped
            automatically, and nothing existing is ever replaced.
          </p>
          <div className="mt-4">
            <BulkLeadsImportForm />
          </div>
        </section>

        <section className="card rounded-2xl border border-line bg-surface p-6">
          <h2 className="text-lg font-semibold tracking-tight text-ink">Meta leads</h2>
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
