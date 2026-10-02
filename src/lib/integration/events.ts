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
  return null;
}

export function possibleNationalPhone(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const digits = value.replace(/\D/g, '');
  const national = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
  return /^[6-9]\d{9}$/.test(national) ? national : null;
}

/** A CRM Customer ID: exactly six digits (drizzle/0015). */
export function possibleCustomerCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^\d{6}$/.test(trimmed) ? trimmed : null;
}
