export type WalktrackEvent = {
  eventId: string;
  type: 'walkin.created' | 'walkin.updated' | 'walkin.deleted';
  source: 'walktrack';
  entityId: string;
  occurredAt: string;
  version: 1;
  data: Record<string, unknown>;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseWalktrackEvent(input: unknown): WalktrackEvent | null {
  if (!input || typeof input !== 'object') return null;
  const value = input as Partial<WalktrackEvent>;
  if (!value.eventId || !uuid.test(value.eventId)) return null;
  if (!value.entityId || typeof value.entityId !== 'string') return null;
  if (value.source !== 'walktrack' || value.version !== 1) return null;
  if (!['walkin.created', 'walkin.updated', 'walkin.deleted'].includes(value.type ?? '')) return null;
  if (!value.occurredAt || Number.isNaN(Date.parse(value.occurredAt))) return null;
  if (!value.data || typeof value.data !== 'object' || Array.isArray(value.data)) return null;
  return value as WalktrackEvent;
}

export function canonicalStoreCode(value: unknown): string | null {
  if (value === 'MG_ROAD') return 'MG_ROAD';
  if (value === 'JAYNAGAR' || value === 'JAYANAGAR') return 'JAYANAGAR';
  if (value === 'SHUBH_CONVENTION' || value === 'BLVD_COLLECTION' || value === 'THE_RESIDENCY_CHENNAI') return value;
  return null;
}

export function possibleNationalPhone(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const digits = value.replace(/\D/g, '');
  const national = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
  return /^[6-9]\d{9}$/.test(national) ? national : null;
}

/** A CRM Customer ID, CUS-000001 (drizzle/0017). The prefix may be left off when typed. */
export function possibleCustomerCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /^(?:CUS-?)?(\d{6})$/i.exec(value.trim());
  return match ? `CUS-${match[1]}` : null;
}

/**
 * A WalkTrack start or stop time as an instant. WalkTrack keeps the store's clock time (IST) in a
 * column with no time zone, so its events carry e.g. "2026-10-27T16:08:00" with no offset; read
 * that as IST. A time that does carry an offset (or Z) is left as it is.
 */
export function walktrackClockTime(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).trim();
  return /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(text) ? `${text.replace(' ', 'T')}+05:30` : text;
}
