'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { partnerLabel, reportToOs } from '@/lib/os-alerts';
import { MONTH, PARTNER_STATUS_LABEL, PARTNER_STATUSES, type PartnerStatus } from '@/lib/partners/constants';
import {
  addCategory, activeCategoryNames, cancelScheduledVersion, renameCategory, saveRuleVersion, setCategoryActive, type RuleLevel,
} from '@/lib/partners/rules';
import {
  declineExistingReferral, markPaid, PartnerError, rejectCommission, reopenCommission, rotateDashboardLink, savePartnerDocuments,
  setPartnerLevel, setPartnerStatus, updatePartnerDetails, validateCommissions, verifyReferral,
} from '@/lib/partners/store';

const str = (form: FormData, key: string, max = 500) => String(form.get(key) ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const orNull = (s: string) => s || null;
const back = (form: FormData, fallback: string) => {
  const to = str(form, 'back', 300);
  return to.startsWith('/partners') ? to : fallback;
};
const withParam = (path: string, key: string, value: string) => `${path}${path.includes('?') ? '&' : '?'}${key}=${encodeURIComponent(value)}`;

/**
 * Runs a change, then returns to the page it came from: with `notice` on success, or the error to show. With `alert`,
 * a successful change is also reported to Hemparshwa OS for the admins' email (lib/os-alerts.ts).
 */
async function act(form: FormData, fallback: string, run: () => Promise<string | void>, alert?: string) {
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
  if (alert) {
    await reportToOs({
      subject: `${alert}: ${notice || 'changed'}`,
      lines: [
        form.has('id') && (await partnerLabel(form.get('id')).catch(() => null)),
        str(form, 'month', 7) && `Month: ${str(form, 'month', 7)}`,
        str(form, 'effectiveMonth', 7) && `In force from: ${str(form, 'effectiveMonth', 7)}`,
        str(form, 'reference', 120) && `Reference: ${str(form, 'reference', 120)}`,
        (str(form, 'reason') || str(form, 'note')) && `Reason: ${str(form, 'reason') || str(form, 'note')}`,
      ],
      path: fallback,
      actor: str(form, 'by', 80) || null,
    }).catch((e) => console.error('os alert:', (e as Error).message));
  }
  redirect(notice ? withParam(to, 'notice', notice) : to);
}

const partnerId = (form: FormData) => {
  const id = Number(form.get('id'));
  if (!Number.isInteger(id) || id <= 0) throw new PartnerError('Unknown partner');
  return id;
};

/** Any status change (approve, reject, hold, suspend, reactivate, terminate): `to`, a reason and the name of who made it. */
export async function statusAction(form: FormData) {
  await act(form, '/partners/list', async () => {
    const to = PARTNER_STATUSES.find((x) => x === str(form, 'to', 20)) as PartnerStatus | undefined;
    if (!to) throw new PartnerError('Choose the new status');
    const code = await setPartnerStatus(partnerId(form), to, orNull(str(form, 'reason')), orNull(str(form, 'by', 80)));
    return code ? `Approved as ${code}` : `Now ${PARTNER_STATUS_LABEL[to].toLowerCase()}`;
  }, 'Partner status');
}
export async function levelAction(form: FormData) {
  await act(form, '/partners/list', async () => {
    await setPartnerLevel(partnerId(form), form.get('level'), orNull(str(form, 'reason')), orNull(str(form, 'by', 80)));
    return 'Partnership level changed';
  }, 'Partner level');
}
export async function detailsAction(form: FormData) {
  await act(form, '/partners/list', async () => {
    const fullName = str(form, 'fullName', 120), email = str(form, 'email', 160).toLowerCase(), city = str(form, 'city', 80), category = str(form, 'category', 60);
    if (!fullName || !email || !city) throw new PartnerError('Name, email and city are required');
    const allowed = await activeCategoryNames();
    if (!allowed.includes(category) && category !== str(form, 'currentCategory', 60)) throw new PartnerError('Choose a partner category');
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
    const ids = form.getAll('commission').map(Number).filter((n) => Number.isInteger(n) && n > 0);
    if (!ids.length) throw new PartnerError('Tick at least one bill to validate');
    const { validated, unverified } = await validateCommissions(ids);
    if (!validated && unverified) throw new PartnerError('Verify these existing customers’ referrals first');
    return `${validated} validated${unverified ? `; ${unverified} wait for their referral to be verified` : ''}`;
  });
}
export async function verifyReferralAction(form: FormData) {
  await act(form, '/partners/referrals', async () => {
    const id = Number(form.get('referral'));
    if (str(form, 'decision', 10) === 'decline') {
      await declineExistingReferral(id, orNull(str(form, 'by', 80)), orNull(str(form, 'note')));
      return 'Referral not accepted: it will not earn';
    }
    await verifyReferral(id, orNull(str(form, 'by', 80)), orNull(str(form, 'note')));
    return 'Referral verified: its bills can be validated';
  });
}
export async function rejectCommissionAction(form: FormData) {
  await act(form, '/partners/referrals', async () => { await rejectCommission(Number(form.get('commission')), str(form, 'note')); return 'Commission rejected'; }, 'Partner commission');
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
  }, 'Partner payout');
}

const amount = (form: FormData, key: string, label: string) => {
  const raw = str(form, key, 20).replace(/[₹,\s%]/g, '');
  const n = raw === '' ? NaN : Number(raw);
  if (!Number.isFinite(n)) throw new PartnerError(`${label}: enter a number`);
  return Math.round(n * 100) / 100;
};

export async function rulesAction(form: FormData) {
  await act(form, '/partners/rules', async () => {
    const levels: RuleLevel[] = [1, 2, 3, 4, 5].map((level) => ({
      level,
      name: str(form, `name_${level}`, 60) || `Level ${level}`,
      minSales: level === 1 ? 0 : amount(form, `min_${level}`, `Level ${level} minimum sales`),
      commissionPercent: amount(form, `percent_${level}`, `Level ${level} commission %`),
      bonus: amount(form, `bonus_${level}`, `Level ${level} bonus`),
      influencerLimit: amount(form, `influencer_${level}`, `Level ${level} influencer fee limit`),
      personalDiscount: amount(form, `discount_${level}`, `Level ${level} personal discount`),
      benefits: str(form, `benefits_${level}`, 300),
    }));
    const terms = {
      referralDays: amount(form, 'referralDays', 'Referral validity'), lookbackYears: amount(form, 'lookbackYears', 'Look-back'),
      reviewMonths: amount(form, 'reviewMonths', 'Months averaged'), downgradeAfter: amount(form, 'downgradeAfter', 'Reviews below'),
      annualShoppingLimit: amount(form, 'annualShoppingLimit', 'Annual shopping limit'),
      tdsPercent: amount(form, 'tdsPercent', 'TDS %'), tdsAnnualThreshold: amount(form, 'tdsAnnualThreshold', 'TDS threshold'),
      minPayout: amount(form, 'minPayout', 'Minimum payout'), largeBillFlag: amount(form, 'largeBillFlag', 'Large bill review'),
      verifyByDay: amount(form, 'verifyByDay', 'Verify by'), approveByDay: amount(form, 'approveByDay', 'Approve by'), payByDay: amount(form, 'payByDay', 'Pay by'),
      existingCustomers: true,
    };
    const effectiveMonth = str(form, 'effectiveMonth', 7);
    await saveRuleVersion({ levels, terms, effectiveMonth, reason: str(form, 'reason'), changedBy: str(form, 'by', 80) });
    return `Rules saved: in force from ${effectiveMonth}`;
  }, 'Partner rules');
}
export async function cancelRulesAction(form: FormData) {
  await act(form, '/partners/rules', async () => { await cancelScheduledVersion(Number(form.get('version'))); return 'Scheduled rules cancelled'; }, 'Partner rules');
}
export async function categoryAction(form: FormData) {
  await act(form, '/partners/rules', async () => {
    const op = str(form, 'op', 10), name = str(form, 'name', 60);
    if (op === 'add') { await addCategory(name); return 'Category added'; }
    if (op === 'rename') { await renameCategory(name, str(form, 'to', 60)); return 'Category renamed'; }
    if (op === 'hide' || op === 'show') { await setCategoryActive(name, op === 'show'); return op === 'hide' ? 'Category hidden from the application form' : 'Category offered again'; }
    throw new PartnerError('Unknown change');
  }, 'Partner categories');
}
