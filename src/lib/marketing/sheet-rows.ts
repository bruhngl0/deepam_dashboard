/**
 * Turns the raw cells of a Google Sheet tab into the rows `previewRows`
 * already understands, so a live sheet goes through exactly the same
 * validation, phone identity and merge rules as an uploaded file.
 */

import { guessMapping, type Mapping } from './local';

export const LEAD_FIELDS = ['phone', 'name', 'email', 'city', 'source', 'campaignId', 'preferredStore', 'date', 'cost'] as const;
export type LeadField = typeof LEAD_FIELDS[number];
export type LeadMapping = Record<LeadField, string>;

/** Canonical rows are keyed by field name, so each field maps to itself. */
export const CANONICAL: Mapping = { phone: 'phone', name: 'name', email: 'email', city: 'city', source: 'source', campaignId: 'campaignId', preferredStore: 'preferredStore', date: 'date', cost: 'cost', invoice: '', amount: '' };

export function gridHeaders(grid: unknown[][]): string[] {
  const headers = (grid[0] ?? []).map((v) => String(v ?? '').trim());
  const named = headers.filter(Boolean);
  if (!named.length) throw new Error('No columns found. Put column headings in the first row.');
  if (new Set(named).size !== named.length) throw new Error('Duplicate column names. Give each column a unique header.');
  return headers;
}

/** Row `i` here is sheet row `i + 2`, which is how `previewRows` numbers its errors. */
export function gridToRows(grid: unknown[][]): Record<string, unknown>[] {
  const headers = gridHeaders(grid);
  return grid.slice(1).map((row) => Object.fromEntries(headers.flatMap((h, i) => (h ? [[h, row[i] ?? '']] : []))));
}

export function guessLeadMapping(headers: string[]): LeadMapping {
  const guess = guessMapping(headers.filter(Boolean));
  return Object.fromEntries(LEAD_FIELDS.map((f) => [f, guess[f]])) as LeadMapping;
}

/**
 * Trackers often put a title banner above the column headings. The header is
 * the first of the top rows that names both a phone and a name column; a tab
 * without one (a summary, a pivot) is not a lead list and returns -1.
 */
const HEADER_SEARCH_ROWS = 10;
export function findHeaderRow(grid: unknown[][]): number {
  return grid.slice(0, HEADER_SEARCH_ROWS).findIndex((row) => {
    const guess = guessMapping(row.map((v) => String(v ?? '').trim()).filter(Boolean));
    return !!guess.phone && !!guess.name;
  });
}

/**
 * A Sheets date cell as IST wall-clock text. Serial 0 is 1899-12-30; the
 * fraction is the time of day. A whole number is a date with no time.
 */
export function serialToDateTime(serial: number): string {
  if (!Number.isFinite(serial) || serial < 1 || serial > 110000) return String(serial);
  const stamp = new Date(Math.round((serial - 25569) * 86400) * 1000).toISOString();
  return Number.isInteger(serial) ? stamp.slice(0, 10) : `${stamp.slice(0, 10)} ${stamp.slice(11, 19)}`;
}

/**
 * One tab as canonical rows, with its columns matched by heading. `first` is
 * the sheet row number of `rows[0]`. Null when the tab is not a lead list.
 */
export function tabRows(grid: unknown[][], defaultSource: string): { mapping: LeadMapping; first: number; rows: Record<string, unknown>[] } | null {
  const header = findHeaderRow(grid);
  if (header < 0) return null;
  const body = grid.slice(header);
  const mapping = guessLeadMapping(gridHeaders(body));
  return { mapping, first: header + 2, rows: canonicalRows(gridToRows(body), mapping, defaultSource) };
}

export function canonicalRows(rows: Record<string, unknown>[], mapping: LeadMapping, defaultSource: string): Record<string, unknown>[] {
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const field of LEAD_FIELDS) out[field] = mapping[field] ? row[mapping[field]] ?? '' : '';
    // Leave an empty row empty, so it is skipped rather than rejected for having only a default source.
    if (Object.values(out).every((v) => String(v).trim() === '')) return out;
    if (typeof out.date === 'number') out.date = serialToDateTime(out.date);
    if (!String(out.source).trim()) out.source = defaultSource;
    return out;
  });
}
