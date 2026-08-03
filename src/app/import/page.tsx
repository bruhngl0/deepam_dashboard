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

import { ImportForm } from '@/components/import-form';
import { requireUser } from '@/lib/auth';

export default async function ImportPage() {
  await requireUser();

  const commitEnabled = process.env.ALLOW_MASTER_SHEET_IMPORT === 'true';

  return (
    <main className="mx-auto w-full max-w-[92rem] px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Import</h1>
        <p className="mt-1 max-w-[68ch] text-sm text-ink-2">
          Load a cleaned master workbook (D-84) — one sheet per channel: Meta, WhatsApp, Google
          Ads, Others. Preview first; nothing is written until you confirm.
        </p>
      </header>

      <section className="rounded-2xl border border-line bg-surface p-6 shadow-sm">
        <ImportForm commitEnabled={commitEnabled} />
      </section>
    </main>
  );
}
