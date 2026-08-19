/**
 * Log one outreach attempt.
 *
 * A Route Handler rather than a Server Action, matching how every other write
 * in this app is done (the import commit routes) — one convention, one place
 * to look for the auth check.
 *
 * `requireApiUser` rather than `requireUser`: a `redirect()` mid-fetch would
 * hand the caller a followed 200 for the sign-in HTML instead of a status it
 * can branch on. The signed-in user's id becomes `contacted_by`, so the log
 * records who made the call rather than trusting a field from the client.
 *
 * Every field is validated here rather than at the query layer: `outcome` is
 * checked against the enum, `listKind` against the two known lists, and
 * `customerId` must be a positive integer. `recordContact` interpolates
 * nothing — the values are bound — but a bad `outcome` would otherwise fail
 * as a Postgres cast error with a 500, when it is plainly a 400.
 */

import { requireApiUser } from '@/lib/auth';
import { recordContact, isOutcome, type ListKind } from '@/lib/queries/worklist';

const LISTS: ListKind[] = ['reactivation', 'second_visit'];

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (auth instanceof Response) return auth;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: 'Body must be JSON.' }, { status: 400 });
  }

  const customerId = Number(body.customerId);
  if (!Number.isSafeInteger(customerId) || customerId <= 0) {
    return Response.json({ error: 'customerId must be a positive integer.' }, { status: 400 });
  }

  const listKind = body.listKind as ListKind;
  if (!LISTS.includes(listKind)) {
    return Response.json(
      { error: `listKind must be one of: ${LISTS.join(', ')}.` },
      { status: 400 },
    );
  }

  if (!isOutcome(body.outcome)) {
    return Response.json({ error: 'outcome is not a known call outcome.' }, { status: 400 });
  }

  // A note is free text from a store manager mid-call — trimmed and capped,
  // never rejected for its contents.
  const rawNote = typeof body.note === 'string' ? body.note.trim() : '';
  const note = rawNote ? rawNote.slice(0, 2000) : null;

  const score = Number.isFinite(Number(body.score)) ? Number(body.score) : null;

  const { id } = await recordContact({
    customerId,
    listKind,
    outcome: body.outcome,
    note,
    score,
    userId: auth,
  });

  return Response.json({ id, outcome: body.outcome }, { status: 201 });
}
