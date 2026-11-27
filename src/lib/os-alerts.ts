import { after } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { appOrigin } from '@/lib/partners/links';
import { rowsOf } from '@/lib/partners/store';

/*
 * Reports a CRM change to Hemparshwa OS, which emails the admins (OS /notifications: "Changes reported by other
 * apps", evening digest by default). Sent after the response, once the change is saved: an OS outage never blocks or
 * undoes the change here, it only means that one alert is missed (and logged below). Uses the same OS link as the
 * desks: HEMPARSHWA_URL + HEMPARSHWA_INTEGRATION_TOKEN.
 */

export type OsAlert = { subject: string; lines?: (string | null | undefined | false)[]; path?: string | null; actor?: string | null };

export async function reportToOs(a: OsAlert) {
  const base = process.env.HEMPARSHWA_URL?.replace(/\/+$/, '');
  const token = process.env.HEMPARSHWA_INTEGRATION_TOKEN;
  if (!base || !token) return;
  // Read the request's address now: headers() isn't available inside after().
  const origin = await appOrigin().catch(() => null);
  const href = a.path && origin?.startsWith('https://') ? `${origin}${a.path}` : null;
  const body = (a.lines ?? []).filter(Boolean).join('\n') || null;
  after(async () => {
    try {
      const res = await fetch(`${base}/api/integration/notify`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ source: 'crm', subject: a.subject.slice(0, 300), body, href, actor: a.actor || null }),
        cache: 'no-store',
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) throw new Error(`notify returned ${res.status}`);
    } catch (err) {
      console.error(`os alert not sent (${a.subject}): ${(err as Error).message}`);
    }
  });
}

/** "DPR-00012 Asha Rao" for a partner id, for alert text. */
export async function partnerLabel(id: unknown): Promise<string | null> {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return null;
  const r = rowsOf<{ code: string | null; name: string }>(await db.execute(sql`SELECT partner_code AS code, full_name AS name FROM partners WHERE id = ${n}`))[0];
  return r ? [r.code, r.name].filter(Boolean).join(' ') : null;
}

/** The partner behind a settlement id, for alert text. */
export async function settlementLabel(id: unknown): Promise<string | null> {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return null;
  const r = rowsOf<{ partner_id: number; month: string }>(await db.execute(sql`SELECT partner_id, month FROM partner_settlements WHERE id = ${n}`))[0];
  return r ? `${(await partnerLabel(r.partner_id)) ?? `partner ${r.partner_id}`}, ${r.month} statement` : null;
}
