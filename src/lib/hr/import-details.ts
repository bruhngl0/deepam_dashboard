/**
 * Reads the HRMS "Employee Basic Details" export (one row per employee, keyed by "EMP ID") into the fields HR
 * Intelligence keeps. Only the columns named below are read; everything else in the file (Aadhaar, PAN, bank, PF…)
 * is never looked at. No database access, so it is unit tested; ./employees.ts applies the result.
 */

import { readWorkbook, sheetToRows } from '@/lib/excel';

export type BasicDetails = { employeeCode: string; name: string | null; dateOfBirth: string | null; contactNo: string | null; email: string | null; biometricId: string | null };
export type ParsedDetails = { rows: BasicDetails[]; issues: string[] };

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const norm = (h: unknown) => String(h ?? '').toUpperCase().replace(/\(.*?\)/g, '').replace(/[^A-Z0-9]+/g, ' ').trim();
const COLUMNS = {
  employeeCode: ['EMP ID', 'EMPLOYEE ID', 'EMPLOYEE NUMBER', 'EMP CODE'],
  name: ['DISPLAY NAME', 'NAME', 'EMPLOYEE NAME'],
  dateOfBirth: ['DATE OF BIRTH', 'DOB'],
  contactNo: ['MOBILE NUMBER', 'MOBILE', 'CONTACT NO', 'PHONE'],
  email: ['EMAIL', 'WORK EMAIL'],
  biometricId: ['BIOMETRIC ID', 'BIOMETRIC'],
} as const;

/** An Excel date serial, "16-May-1962", "16/05/1962" or "1962-05-16" → "1962-05-16". */
export function toIsoDate(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number' && v > 0 && v < 100_000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86_400_000);
    return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[-/ .]([A-Za-z]{3})[A-Za-z]*[-/ .](\d{4})$/);
  if (m && MONTHS.includes(m[2].toUpperCase())) return valid(Number(m[3]), MONTHS.indexOf(m[2].toUpperCase()) + 1, Number(m[1]));
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) return valid(Number(m[3]), Number(m[2]), Number(m[1]));
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return valid(Number(m[1]), Number(m[2]), Number(m[3]));
  return null;
}
function valid(y: number, mo: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? dt.toISOString().slice(0, 10) : null;
}

/** An Indian mobile as 10 digits; null when it is not one. */
export function toMobile(v: unknown): string | null {
  const digits = String(v ?? '').replace(/\D/g, '').replace(/^(?:91|0)(?=\d{10}$)/, '');
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

export function parseDetails(rows: unknown[][]): ParsedDetails {
  const headerAt = rows.findIndex((r) => r.some((c) => (COLUMNS.employeeCode as readonly string[]).includes(norm(c))));
  if (headerAt < 0) throw new Error('No "EMP ID" column found in the file');
  const header = rows[headerAt].map(norm);
  const col = (names: readonly string[]) => header.findIndex((h) => names.includes(h));
  const at = Object.fromEntries(Object.entries(COLUMNS).map(([k, names]) => [k, col(names)])) as Record<keyof typeof COLUMNS, number>;
  const out: BasicDetails[] = [], issues: string[] = [], seen = new Set<string>();
  for (const r of rows.slice(headerAt + 1)) {
    const code = String(r[at.employeeCode] ?? '').trim().toUpperCase().replace(/\s+/g, '');
    if (!code) continue;
    if (!/^[A-Z]{2,6}[0-9]{2,6}$/.test(code)) { issues.push(`"${code}" is not an Employee ID; row skipped`); continue; }
    if (seen.has(code)) { issues.push(`${code} appears twice; the first row is used`); continue; }
    seen.add(code);
    const cell = (k: keyof typeof COLUMNS) => (at[k] < 0 ? null : r[at[k]]);
    const text = (k: keyof typeof COLUMNS) => { const v = String(cell(k) ?? '').trim().replace(/\s+/g, ' '); return v || null; };
    const dob = toIsoDate(cell('dateOfBirth')), mobile = toMobile(cell('contactNo'));
    if (cell('dateOfBirth') !== null && cell('dateOfBirth') !== '' && !dob) issues.push(`${code}: date of birth "${cell('dateOfBirth')}" not understood`);
    if (text('contactNo') && !mobile) issues.push(`${code}: mobile "${text('contactNo')}" is not a 10-digit Indian number`);
    out.push({ employeeCode: code, name: text('name'), dateOfBirth: dob, contactNo: mobile, email: text('email')?.toLowerCase() ?? null, biometricId: text('biometricId') });
  }
  return { rows: out, issues };
}

export function readDetailsFile(data: Buffer): ParsedDetails {
  const wb = readWorkbook(data);
  return parseDetails(sheetToRows(wb, wb.SheetNames[0]));
}
