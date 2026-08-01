/**
 * Spreadsheet reading helpers shared by every importer.
 *
 * Two things here are load-bearing and easy to get wrong:
 *
 *   1. Dates. Excel stores them as serial numbers with no timezone. Letting a
 *      library guess produces a value that shifts with the server's clock — a
 *      5h30m error is enough to move a sale across a day boundary and out of
 *      its attribution window. We read raw serials and stamp IST ourselves. (D-32)
 *
 *   2. Headers. The Meta workbook has five sheets with differently-cased,
 *      differently-ordered columns, so nothing may be read by position. (D-08)
 */

import * as XLSX from 'xlsx';

/** Store timezone. Everything is persisted as UTC; this is the input frame. (D-32) */
export const IST_OFFSET_MINUTES = 330; // +05:30

/**
 * Read a workbook with the settings every parser in this codebase expects.
 *
 * `cellDates: false` is deliberate — we want the raw serial, not a Date object
 * that SheetJS has already localized using the server's timezone.
 */
export function readWorkbook(data: Buffer | ArrayBuffer) {
  return XLSX.read(data, { type: 'buffer', cellDates: false, raw: true });
}

/** Every row of a sheet as a positional array, blanks preserved as null. */
export function sheetToRows(
  workbook: XLSX.WorkBook,
  sheetName: string,
): unknown[][] {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error(`Sheet not found: ${sheetName}`);
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: true,
  });
}

/** Normalize a header for comparison: lowercase, strip spaces/underscores/punctuation. */
export function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[\s_\-.?()/]/g, '');
}

/**
 * Map header names to column indexes. Matching is on the normalized header
 * containing the needle, so `Phone_number`, `phone_number` and `phone` all
 * resolve together. (D-08)
 */
export function mapColumns<K extends string>(
  header: unknown[],
  spec: Record<K, string | string[]>,
): Record<K, number> {
  const normalized = header.map(normalizeHeader);
  const out = {} as Record<K, number>;

  for (const [key, needles] of Object.entries(spec) as [K, string | string[]][]) {
    const candidates = Array.isArray(needles) ? needles : [needles];
    let index = -1;
    for (const needle of candidates) {
      const n = normalizeHeader(needle);
      // Prefer an exact header match before falling back to a substring, so
      // "phone" cannot be captured by a column called "phonepay".
      index = normalized.findIndex((h) => h === n);
      if (index >= 0) break;
      index = normalized.findIndex((h) => h !== '' && h.includes(n));
      if (index >= 0) break;
    }
    out[key] = index;
  }

  return out;
}

/**
 * Convert an Excel date serial to its calendar parts, with no timezone applied.
 *
 * Excel's epoch is 1899-12-30 (the offset absorbs its 1900-leap-year bug). The
 * arithmetic is done in UTC purely so it is deterministic — the result is a
 * naive wall-clock date, not an instant.
 */
export function excelSerialToParts(serial: number): {
  year: number;
  month: number;
  day: number;
} {
  const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);
  const d = new Date(EXCEL_EPOCH_UTC + Math.floor(serial) * 86_400_000);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
}

/** Parse `"11:29:36"` (or `"11:29"`) into hours/minutes/seconds. */
export function parseClockTime(value: unknown): {
  hours: number;
  minutes: number;
  seconds: number;
} | null {
  if (value === null || value === undefined) return null;

  // Excel may also store a time as a fraction of a day.
  if (typeof value === 'number' && value >= 0 && value < 1) {
    const total = Math.round(value * 86_400);
    return {
      hours: Math.floor(total / 3600),
      minutes: Math.floor((total % 3600) / 60),
      seconds: total % 60,
    };
  }

  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(value).trim());
  if (!m) return null;

  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  const seconds = m[3] ? Number(m[3]) : 0;
  if (hours > 23 || minutes > 59 || seconds > 59) return null;

  return { hours, minutes, seconds };
}

/**
 * Combine an Excel date serial and a clock-time string into a UTC instant,
 * interpreting the wall-clock reading as IST. (D-33)
 *
 *   serial 46222 + "11:29:36"  →  2026-07-19T05:59:36.000Z
 */
export function toUtcInstant(
  dateSerial: number,
  time: unknown = null,
): Date | null {
  if (!Number.isFinite(dateSerial) || dateSerial <= 0) return null;

  const { year, month, day } = excelSerialToParts(dateSerial);
  const clock = parseClockTime(time) ?? { hours: 0, minutes: 0, seconds: 0 };

  const utcMillis =
    Date.UTC(year, month - 1, day, clock.hours, clock.minutes, clock.seconds) -
    IST_OFFSET_MINUTES * 60_000;

  return new Date(utcMillis);
}

/** Parse an ISO-ish timestamp string, e.g. the walk-in `2026-07-19 06:15:58.99+00`. */
export function parseTimestamp(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  const text = String(value).trim();
  // "2026-07-19 06:15:58.991219+00" → replace the space so Date can read it,
  // and pad a bare "+00" offset to "+00:00".
  const iso = text
    .replace(' ', 'T')
    .replace(/([+-]\d{2})$/, '$1:00');
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** A number, or null for blanks and unparseable values. Never NaN. */
export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** A trimmed non-empty string, or null. */
export function toText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}
