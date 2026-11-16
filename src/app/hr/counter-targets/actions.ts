'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { parseRules, RuleError } from '@/lib/hr/counter-rules';
import { copyTargets, isTargetStore, MONTH, saveTargets, type TargetInput } from '@/lib/hr/counter-targets';

const count = (v: FormDataEntryValue | null) => {
  const s = String(v ?? '').replace(/[,\s]/g, '');
  if (!s) return null;
  const n = Number(s);
  if (!Number.isInteger(n) || n < 0) throw new RuleError(`"${v}" is not a number of pieces`);
  return n;
};

export async function saveCounterTargets(form: FormData) {
  await requireUser();
  const store = String(form.get('store')), month = String(form.get('month'));
  if (!isTargetStore(store) || !MONTH.test(month)) throw new Error('Unknown store or month');
  const back = `/hr/counter-targets/edit?store=${store}&month=${month}`;
  const codes = form.getAll('codes'), assistants = form.getAll('assistants'), t1 = form.getAll('target_1'), t2 = form.getAll('target_2');
  const rows: TargetInput[] = [];
  try {
    codes.forEach((c, i) => {
      const text = String(c).trim().replace(/\s+/g, ' ');
      const target1 = count(t1[i]);
      if (!text && target1 === null) return; // an empty row
      parseRules(text);
      if (target1 === null) throw new RuleError(`Target 1 is missing for "${text}"`);
      const target2 = count(t2[i]);
      if (target2 !== null && target2 < target1) throw new RuleError(`Target 2 should be at least Target 1 for "${text}"`);
      rows.push({ codes: text, assistants: String(assistants[i] ?? '').trim().replace(/\s+/g, ' ') || null, target1, target2 });
    });
  } catch (e) {
    if (e instanceof RuleError) redirect(`${back}&error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  await saveTargets(store, month, rows);
  revalidatePath('/hr/counter-targets');
  redirect(`/hr/counter-targets?month=${month}`);
}

export async function copyCounterTargets(form: FormData) {
  await requireUser();
  const from = String(form.get('from')), to = String(form.get('to'));
  if (!MONTH.test(from) || !MONTH.test(to)) throw new Error('Unknown month');
  await copyTargets(from, to);
  revalidatePath('/hr/counter-targets');
  redirect(`/hr/counter-targets?month=${to}`);
}
