/**
 * POST the HRMS "Employee Basic Details" workbook (field `file`): fills date of birth, Contact No., Biometric ID and
 * an empty email for employees already on the list, then returns to /hr/employees/import with what happened.
 * Behind the HR Intelligence password like every /hr route.
 */

import { requireApiUser } from '@/lib/auth';
import { applyBasicDetails } from '@/lib/hr/employees';
import { readDetailsFile } from '@/lib/hr/import-details';
import { revalidatePath } from 'next/cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 10 * 1024 * 1024;

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (auth instanceof Response) return auth;
  const back = (q: Record<string, string>) => new Response(null, { status: 303, headers: { location: `/hr/employees/import?${new URLSearchParams(q)}` } });
  const file = (await request.formData()).get('file');
  if (!(file instanceof File) || !file.size) return back({ error: 'Choose the Excel file first' });
  if (file.size > MAX_BYTES) return back({ error: 'The file is larger than 10 MB' });
  let parsed;
  try {
    parsed = readDetailsFile(Buffer.from(await file.arrayBuffer()));
  } catch (e) {
    return back({ error: e instanceof Error ? e.message : 'The file could not be read' });
  }
  const result = await applyBasicDetails(parsed.rows);
  revalidatePath('/hr', 'layout');
  return back({
    rows: String(parsed.rows.length), updated: String(result.updated), unchanged: String(result.unchanged),
    skipped: result.notOnList.join(','), issues: [...parsed.issues, ...result.conflicts].slice(0, 30).join('\n'),
  });
}
