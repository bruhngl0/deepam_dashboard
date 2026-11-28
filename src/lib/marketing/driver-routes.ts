import { DRIVER_VIEWS, driverDesk, isOutcome, logDriverCall, type DriverView } from './driver-desk';
import { nowLocal } from './local';

/* Request handling shared by Marketing's Drivers page (/api/marketing/drivers) and the calling desks (/sales/api/drivers). */

export async function driverDeskResponse(request: Request, caller: string | null) {
  const params = new URL(request.url).searchParams;
  const page = Number(params.get('page') ?? 0);
  const view = (params.get('view') ?? 'All') as DriverView;
  if (!Number.isSafeInteger(page) || page < 0) return Response.json({ error: 'Invalid page.' }, { status: 400 });
  if (!DRIVER_VIEWS.includes(view)) return Response.json({ error: 'Invalid view.' }, { status: 400 });
  const search = (params.get('search') ?? '').trim().slice(0, 100);
  return Response.json(await driverDesk({ view, search, page, caller, today: nowLocal().slice(0, 10) }));
}

export async function driverCallResponse(request: Request, rawId: string, caller: string) {
  const id = Number(rawId);
  const body = await request.json().catch(() => null) as { outcome?: unknown; note?: unknown } | null;
  if (!Number.isSafeInteger(id) || id < 1 || !isOutcome(body?.outcome)) return Response.json({ error: 'Choose how the call went.' }, { status: 422 });
  const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 2000) : '';
  const saved = await logDriverCall({ id, caller, outcome: body.outcome, note, calledAt: nowLocal() });
  return saved ? Response.json({ saved: true }) : Response.json({ error: 'That driver is no longer on the list.' }, { status: 404 });
}
