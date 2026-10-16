import * as XLSX from 'xlsx';
import { normalizePhone, REJECT_CODE } from '@/lib/phone';

export const EXHIBITION_LIST_KEY = 'exhibition-customers';
export const EXHIBITION_LIST_NAME = 'Exhibition customer calls';
/** Shopify buyers and sign-ups new to the CRM (scripts/import-shopify-customers.ts). */
export const ONLINE_LIST_KEY = 'online-customers';
export const ONLINE_LIST_NAME = 'Online customer calls';
/** Every calling list a salesperson can be assigned customers from. */
export const CALL_LIST_KEYS = [EXHIBITION_LIST_KEY, ONLINE_LIST_KEY] as const;
export type CallListKey = (typeof CALL_LIST_KEYS)[number];

export type ExistingCustomerCallContact = {
  sourceRow: number;
  sourceCustomerId: string;
  name: string;
  phone: string;
  branch: string;
  city: string;
};

export type ExistingCustomerCallReject = {
  sourceRow: number;
  reason: string;
};

export type ExistingCustomerCallImport = {
  sheetName: string;
  contacts: ExistingCustomerCallContact[];
  rejected: ExistingCustomerCallReject[];
  duplicatePhones: number;
};

const text = (value: unknown) => String(value ?? '').trim();
const headerKey = (value: unknown) => text(value).toLowerCase().replace(/[^a-z0-9]/g, '');

function headerRow(rows: unknown[][]): number {
  const required = new Set(['customername', 'mobile1']);
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const keys = new Set((rows[i] ?? []).map(headerKey));
    if ([...required].every(key => keys.has(key))) return i;
  }
  throw new Error('Could not find Customer Name and Mobile1 columns in the first 10 rows.');
}

export function parseExistingCustomerCallWorkbook(buffer: Buffer): ExistingCustomerCallImport {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('The workbook has no sheets.');
  const grid = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, defval: null, raw: true });
  const headerIndex = headerRow(grid);
  const header = grid[headerIndex].map(headerKey);
  const column = (key: string) => header.indexOf(key);
  const byPhone = new Map<string, ExistingCustomerCallContact>();
  const rejected: ExistingCustomerCallReject[] = [];
  let duplicatePhones = 0;

  for (let index = headerIndex + 1; index < grid.length; index++) {
    const row = grid[index] ?? [];
    if (row.every(value => value === null || text(value) === '')) continue;
    const sourceRow = index + 1;
    const phone = normalizePhone(row[column('mobile1')]);
    if (!phone.ok) {
      rejected.push({ sourceRow, reason: REJECT_CODE[phone.reason] });
      continue;
    }
    if (phone.hadMultiple) {
      rejected.push({ sourceRow, reason: 'phone.multiple' });
      continue;
    }
    const name = text(row[column('customername')]);
    if (!name) {
      rejected.push({ sourceRow, reason: 'name.empty' });
      continue;
    }
    const contact: ExistingCustomerCallContact = {
      sourceRow,
      sourceCustomerId: text(row[column('id')]),
      name,
      phone: phone.e164,
      branch: text(row[column('branchname')]).toUpperCase(),
      city: text(row[column('cityname')]),
    };
    if (byPhone.has(contact.phone)) duplicatePhones++;
    byPhone.set(contact.phone, contact);
  }

  return { sheetName, contacts: [...byPhone.values()], rejected, duplicatePhones };
}
