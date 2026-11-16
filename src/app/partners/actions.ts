'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { MONTH, PARTNER_CATEGORIES } from '@/lib/partners/constants';
import {
  approvePartner, markPaid, PartnerError, rejectCommission, reopenCommission, rotateDashboardLink, savePartnerDocuments,
  saveRules, setPartnerInactive, setPartnerLevel, updatePartnerDetails, validateCommissions, type LevelInput,
} from '@/lib/partners/store';

const str = (form: FormData, key: string, max = 500) => String(form.get(key) ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const orNull = (s: string) => s || null;
const back = (form: FormData, fallback: string) => {
  const to = str(form, 'back', 300);
  return to.startsWith('/partners') ? to : fallback;
};
const withParam = (path: string, key: string, value: string) => `${path}${path.includes('?') ? '&' : '?'}${key}=${encodeURIComponent(value)}`;

/** Runs a change, then returns to the page it came from: with `notice` on success, or the error to show. */
async function act(form: FormData, fallback: string, run: () => Promise<string | void>) {
  await requireUser();
  const to = back(form, fallback);
  let notice: string | void;
  try {
    notice = await run();
  } catch (e) {
    if (e instanceof PartnerError) redirect(withParam(to, 'error', e.message));
    throw e;
  }
  revalidatePath('/partners', 'layout');
  redirect(notice ? withParam(to, 'notice', notice) : to);
}

const partnerId = (form: FormData) => {
  const id = Number(form.get('id'));
  if (!Number.isInteger(id) || id <= 0) throw new PartnerError('Unknown partner');
  return id;
};

export async function approveAction(form: FormData) {
  await act(form, '/partners/list', async () => `Approved as ${await approvePartner(partnerId(form), form.get('level'), orNull(str(form, 'note')))}`);
}
export async function rejectAction(form: FormData) {
  await act(form, '/partners/list', async () => { await setPartnerInactive(partnerId(form), 'rejected', orNull(str(form, 'note'))); return 'Application rejected'; });
}
export async function suspendAction(form: FormData) {
  await act(form, '/partners/list', async () => { await setPartnerInactive(partnerId(form), 'suspended', orNull(str(form, 'note'))); return 'Partner suspended: their link no longer accepts registrations'; });
}
export async function levelAction(form: FormData) {
  await act(form, '/partners/list', async () => { await setPartnerLevel(partnerId(form), form.get('level')); return 'Level changed'; });
}
export async function detailsAction(form: FormData) {
  await act(form, '/partners/list', async () => {
    const fullName = str(form, 'fullName', 120), email = str(form, 'email', 160).toLowerCase(), city = str(form, 'city', 80), category = str(form, 'category', 60);
    if (!fullName || !email || !city) throw new PartnerError('Name, email and city are required');
    if (!PARTNER_CATEGORIES.includes(category as (typeof PARTNER_CATEGORIES)[number])) throw new PartnerError('Choose a partner category');
    await updatePartnerDetails(partnerId(form), { fullName, email, city, category, notes: orNull(String(form.get('notes') ?? '').trim().slice(0, 2000)) });
    return 'Details saved';
  });
}
export async function documentsAction(form: FormData) {
  await act(form, '/partners/list', async () => { await savePartnerDocuments(partnerId(form), form.getAll('documents').map(String)); return 'Documents saved'; });
}
export async function rotateLinkAction(form: FormData) {
  await act(form, '/partners/list', async () => { await rotateDashboardLink(partnerId(form)); return 'New dashboard link made; the old one no longer opens'; });
}

export async function validateAction(form: FormData) {
  await act(form, '/partners/referrals', async () => {
    const month = str(form, 'month', 7);
    if (!MONTH.test(month)) throw new PartnerError('Choose the payout month');
    const ids = form.getAll('commission').map(Number).filter((n) => Number.isInteger(n) && n > 0);
    if (!ids.length) throw new PartnerError('Tick at least one bill to validate');
    const { validated, noRate } = await validateCommissions(ids, month);
    if (!validated && noRate) throw new PartnerError('Set the commission % for these partners’ levels under Rules first');
    return `${validated} validated${noRate ? `; ${noRate} left because their level has no commission % yet` : ''}`;
  });
}
export async function rejectCommissionAction(form: FormData) {
  await act(form, '/partners/referrals', async () => { await rejectCommission(Number(form.get('commission')), str(form, 'note')); return 'Commission rejected'; });
}
export async function reopenCommissionAction(form: FormData) {
  await act(form, '/partners/referrals', async () => { await reopenCommission(Number(form.get('commission'))); return 'Moved back to validate'; });
}

export async function markPaidAction(form: FormData) {
  await act(form, '/partners/payouts', async () => {
    const month = str(form, 'month', 7);
    if (!MONTH.test(month)) throw new PartnerError('Unknown month');
    const n = await markPaid(partnerId(form), month, str(form, 'reference', 120));
    return `${n} commission ${n === 1 ? 'line' : 'lines'} marked paid`;
  });
}

export async function rulesAction(form: FormData) {
  await act(form, '/partners/rules', async () => {
    const levels: LevelInput[] = [1, 2, 3, 4, 5].map((level) => {
      const raw = str(form, `percent_${level}`, 10).replace('%', '');
      const percent = raw === '' ? null : Number(raw);
      if (percent !== null && (!Number.isFinite(percent) || percent < 0 || percent > 100)) throw new PartnerError(`Level ${level}: commission % should be from 0 to 100`);
      return { level, name: str(form, `name_${level}`, 60) || `Level ${level}`, percent: percent === null ? null : Math.round(percent * 100) / 100, notes: orNull(str(form, `notes_${level}`, 300)) };
    });
    const windowDays = Number(str(form, 'windowDays', 4)), lookbackYears = Number(str(form, 'lookbackYears', 2));
    if (!Number.isInteger(windowDays) || windowDays < 1 || windowDays > 365) throw new PartnerError('Purchase window should be 1 to 365 days');
    if (!Number.isInteger(lookbackYears) || lookbackYears < 1 || lookbackYears > 10) throw new PartnerError('Look-back should be 1 to 10 years');
    await saveRules(levels, windowDays, lookbackYears);
    return 'Rules saved';
  });
}
