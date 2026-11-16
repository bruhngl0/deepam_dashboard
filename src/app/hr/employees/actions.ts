'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import {
  addDocument, addFamilyMember, addHistory, clearSalespersonLink, DOCUMENT_KINDS, EMPLOYEE_CODE, employeeExists, HISTORY_KINDS,
  removeRecord, saveEmployee, setSalespersonLink,
} from '@/lib/hr/employees';
import { day, employeeCodeFrom, employeeFromForm, FormError, text } from '@/lib/hr/form';

const back = (code: string, error?: string) => `/hr/employees/${code}${error ? `?error=${encodeURIComponent(error)}` : ''}`;

function codeOf(form: FormData): string {
  const code = String(form.get('code') ?? '');
  if (!EMPLOYEE_CODE.test(code)) throw new Error('Not an Employee ID');
  return code;
}

function done(code: string) {
  revalidatePath('/hr', 'layout');
  redirect(back(code));
}

export async function createEmployee(form: FormData) {
  await requireUser();
  let code: string;
  try {
    code = employeeCodeFrom(form);
    if (await employeeExists(code)) throw new FormError(`${code} is already on the list`);
    await saveEmployee(code, employeeFromForm(form), true);
  } catch (e) {
    if (e instanceof FormError) redirect(`/hr/employees/new?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  done(code);
}

export async function updateEmployee(form: FormData) {
  await requireUser();
  const code = codeOf(form);
  try {
    await saveEmployee(code, employeeFromForm(form), false);
  } catch (e) {
    if (e instanceof FormError) redirect(`/hr/employees/${code}/edit?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  done(code);
}

export async function addRecord(form: FormData) {
  await requireUser();
  const code = codeOf(form);
  try {
    const kind = String(form.get('record'));
    if (kind === 'family') {
      const name = text(form, 'name'), relation = text(form, 'relation', 60);
      if (!name || !relation) throw new FormError('Family member needs a name and relation');
      await addFamilyMember(code, { name, relation, dateOfBirth: day(form, 'date_of_birth'), contactNo: text(form, 'contact_no', 30) });
    } else if (kind === 'history') {
      const k = text(form, 'kind'), on = day(form, 'effective_on');
      if (!k || !(HISTORY_KINDS as readonly string[]).includes(k) || !on) throw new FormError('History needs a type and a date');
      await addHistory(code, { kind: k, effectiveOn: on, fromValue: text(form, 'from_value'), toValue: text(form, 'to_value'), note: text(form, 'note', 500) });
    } else if (kind === 'documents') {
      const k = text(form, 'kind'), url = text(form, 'url', 1000);
      if (!k || !(DOCUMENT_KINDS as readonly string[]).includes(k)) throw new FormError('Pick a document type');
      if (!url || !/^https?:\/\//i.test(url)) throw new FormError('Document link should start with https://');
      await addDocument(code, { kind: k, title: text(form, 'title'), url });
    }
  } catch (e) {
    if (e instanceof FormError) redirect(back(code, e.message));
    throw e;
  }
  done(code);
}

export async function deleteRecord(form: FormData) {
  await requireUser();
  const code = codeOf(form);
  const table = String(form.get('record'));
  if (table !== 'family' && table !== 'history' && table !== 'documents') throw new Error('Unknown record');
  await removeRecord(code, table, Number(form.get('id')));
  done(code);
}

export async function linkSalesperson(form: FormData) {
  await requireUser();
  const code = codeOf(form);
  const pick = String(form.get('salesperson') ?? '');
  if (pick === 'auto') await clearSalespersonLink(code);
  else await setSalespersonLink(code, pick === 'none' ? null : pick);
  done(code);
}
