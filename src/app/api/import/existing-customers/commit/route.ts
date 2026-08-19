/**
 * Existing-customer seed import — commit.
 *
 * Upserts on `customers.phone_e164` / `loyalty_customers.customer_id`. No
 * `ALLOW_*` gate, same reasoning as `preview/route.ts`. `maxDuration` is
 * raised well past the other import routes' 60s — this source runs to six
 * figures of rows in one file, unlike anything else this app imports.
 */

import { previewExistingCustomersImport, commitExistingCustomersImport } from '@/lib/import/existing-customers';
import { requireApiUser } from '@/lib/auth';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (auth instanceof Response) return auth;

  const form = await request.formData();
  const file = form.get('file');

  if (!(file instanceof File)) {
    return Response.json({ error: 'No file uploaded.' }, { status: 400 });
  }
  if (!file.name.match(/\.(csv|xlsx?)$/i)) {
    return Response.json({ error: 'Expected a .csv or .xlsx export.' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    // Re-parsed here, not trusted from the client — same reasoning as every
    // other commit route in this app.
    const preview = await previewExistingCustomersImport(buffer, file.name);
    const summary = await commitExistingCustomersImport(preview, auth);
    return Response.json(summary);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'Import failed.' },
      { status: 500 },
    );
  }
}
