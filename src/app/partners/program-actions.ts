'use server';

/** Settlements, Controls and Programs decisions (lib/partners/program.ts). Each returns to its page with a notice or the error. */

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { partnerLabel, reportToOs, settlementLabel } from '@/lib/os-alerts';
import { PartnerError, refreshReferrals } from '@/lib/partners/store';
import * as P from '@/lib/partners/program';

const str = (form: FormData, key: string, max = 500) => String(form.get(key) ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const orNull = (s: string) => s || null;
const id = (form: FormData, key = 'id') => {
  const v = Number(form.get(key));
  if (!Number.isInteger(v) || v <= 0) throw new PartnerError('Not found');
  return v;
};
const list = (form: FormData, key: string) => form.getAll(key).map(String).map((s) => s.trim()).filter(Boolean);
const words = (s: string) => s.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
const withParam = (path: string, key: string, value: string) => `${path}${path.includes('?') ? '&' : '?'}${key}=${encodeURIComponent(value)}`;

async function act(form: FormData, fallback: string, run: () => Promise<string | void>) {
  await requireUser();
  const back = str(form, 'back', 300);
  const to = back.startsWith('/partners') ? back : fallback;
  let notice: string | void;
  try {
    notice = await run();
    await refreshReferrals();
  } catch (e) {
    if (e instanceof PartnerError) redirect(withParam(to, 'error', e.message));
    if (e instanceof Error && /partner_settlement_payments_ref_uidx/.test(e.message)) redirect(withParam(to, 'error', 'That payment reference has already been recorded'));
    throw e;
  }
  revalidatePath('/partners', 'layout');
  // Every settlement, control and programme decision is reported to Hemparshwa OS for the admins' email.
  const area = fallback.endsWith('/settlements') ? 'Partner settlement' : fallback.endsWith('/controls') ? 'Partner controls' : 'Partner programmes';
  await reportToOs({
    subject: `${area}: ${notice || 'changed'}`,
    lines: [
      fallback.endsWith('/settlements') && form.has('id') && (await settlementLabel(form.get('id')).catch(() => null)),
      form.has('partner') && (await partnerLabel(form.get('partner')).catch(() => null)),
      str(form, 'name', 120) && `Name: ${str(form, 'name', 120)}`,
      str(form, 'voucher', 40) && `Bill: ${str(form, 'voucher', 40)}`,
      str(form, 'amount', 20) && `Amount: ₹${str(form, 'amount', 20)}`,
      str(form, 'month', 7) && `Month: ${str(form, 'month', 7)}`,
      str(form, 'reference', 120) && `Reference: ${str(form, 'reference', 120)}`,
      str(form, 'reason') && `Reason: ${str(form, 'reason')}`,
    ],
    path: fallback.endsWith('/settlements') && form.has('id') ? `/partners/settlements/${Number(form.get('id'))}` : fallback,
    actor: str(form, 'by', 80) || null,
  }).catch((e) => console.error('os alert:', (e as Error).message));
  redirect(notice ? withParam(to, 'notice', notice) : to);
}

// ── Settlements ──
export async function settlementAction(form: FormData) {
  await act(form, '/partners/settlements', async () => {
    const s = id(form), by = orNull(str(form, 'by', 80)), reason = orNull(str(form, 'reason'));
    switch (str(form, 'do', 20)) {
      case 'verify': return (await P.verifySettlement(s, by)) === 'pending_approval' ? 'Verified: waiting for management approval' : 'Verified: nothing to pay, the balance carries forward';
      case 'approve': await P.approveSettlement(s, by); return 'Approved for payment';
      case 'reopen': await P.reopenSettlement(s, by, reason); return 'Sent back to be worked out again';
      case 'hold': await P.holdSettlement(s, by, reason); return 'Statement on hold';
      case 'release': await P.releaseSettlement(s, by); return 'Hold released';
      case 'pay': return (await P.recordPayment(s, form.get('amount'), orNull(str(form, 'paidOn', 10)), orNull(str(form, 'reference', 120)), by)) ? 'Paid in full' : 'Part payment recorded';
      default: throw new PartnerError('Unknown action');
    }
  });
}
export async function adjustmentAction(form: FormData) {
  await act(form, '/partners/controls', async () => {
    if (str(form, 'do', 20) === 'approve') { await P.approveAdjustment(id(form), orNull(str(form, 'by', 80))); return 'Adjustment approved: it goes on the next statement'; }
    await P.addAdjustment(id(form, 'partner'), orNull(str(form, 'month', 7)), form.get('amount'), orNull(str(form, 'reason')), orNull(str(form, 'by', 80)));
    return 'Adjustment entered: another person approves it';
  });
}

// ── Controls ──
export async function claimAction(form: FormData) {
  await act(form, '/partners/controls', async () => {
    if (str(form, 'do', 20) === 'resolve') {
      await P.resolveClaim(id(form), str(form, 'resolution', 10), form.get('share'), orNull(str(form, 'reason')), orNull(str(form, 'by', 80)));
      return 'Claim decided';
    }
    await P.addClaim(orNull(str(form, 'voucher', 40)), str(form, 'type', 20), orNull(str(form, 'name', 120)), orNull(str(form, 'note')), orNull(str(form, 'by', 80)));
    return 'Claim recorded: the bill is on hold until decided';
  });
}
export async function retroAction(form: FormData) {
  await act(form, '/partners/controls', async () => {
    await P.requestRetro(orNull(str(form, 'voucher', 40)), orNull(str(form, 'partner', 20)), orNull(str(form, 'reason')), orNull(str(form, 'by', 80)));
    return 'Requested: the bill is on hold until someone else approves it below';
  });
}
export async function flagAction(form: FormData) {
  await act(form, '/partners/controls', async () => {
    const what = str(form, 'do', 20);
    if (what === 'raise') { await P.raiseFlag(id(form, 'partner'), orNull(str(form, 'voucher', 40)), orNull(str(form, 'detail')), orNull(str(form, 'by', 80))); return 'Flag raised'; }
    if (what !== 'cleared' && what !== 'confirmed') throw new PartnerError('Choose clear or confirm');
    await P.resolveFlag(id(form), what, orNull(str(form, 'reason')), orNull(str(form, 'by', 80)));
    return what === 'cleared' ? 'Cleared: the bill counts again' : 'Confirmed: the bill earns nothing';
  });
}

// ── Programs ──
export async function campaignAction(form: FormData) {
  await act(form, '/partners/programs', async () => {
    const what = str(form, 'do', 20);
    if (what === 'active' || what === 'ended') { await P.setCampaignStatus(id(form), what, orNull(str(form, 'by', 80))); return what === 'active' ? 'Campaign active' : 'Campaign ended'; }
    await P.createCampaign({
      name: str(form, 'name', 120), startsOn: str(form, 'startsOn', 10), endsOn: str(form, 'endsOn', 10), storeCodes: list(form, 'stores'),
      excludedInvoices: words(str(form, 'excluded', 2000)), commissionPercent: form.get('percent'), priority: form.get('priority'),
      countsTowardLevel: form.get('counts') === 'on', bonusEligible: form.get('bonus') === 'on', personalDiscountAllowed: form.get('personal') === 'on',
      minMarginPercent: form.get('margin'), notes: orNull(str(form, 'notes')), by: orNull(str(form, 'by', 80)),
    });
    return 'Campaign saved as a draft: someone else activates it';
  });
}
export async function exclusionAction(form: FormData) {
  await act(form, '/partners/programs', async () => {
    if (str(form, 'do', 20) === 'end') { await P.endExclusion(id(form)); return 'Exclusion ended'; }
    await P.addExclusion(str(form, 'scope', 10), orNull(str(form, 'value', 60)), orNull(str(form, 'from', 10)), orNull(str(form, 'to', 10)), orNull(str(form, 'reason')), orNull(str(form, 'by', 80)));
    return 'Exclusion added';
  });
}
export async function collaborationAction(form: FormData) {
  await act(form, '/partners/programs', async () => {
    const what = str(form, 'do', 20), by = orNull(str(form, 'by', 80));
    if (what === 'approve' || what === 'reject') { await P.decideCollaboration(id(form), what, orNull(str(form, 'reason')), by); return what === 'approve' ? 'Collaboration approved' : 'Collaboration rejected'; }
    if (what === 'complete') { await P.completeCollaboration(id(form), by); return 'Deliverables complete: payable in the month’s statement'; }
    await P.requestCollaboration(id(form, 'partner'), { entity: orNull(str(form, 'entity', 80)), title: orNull(str(form, 'title', 160)), deliverables: orNull(str(form, 'deliverables', 1000)),
      dueOn: orNull(str(form, 'dueOn', 10)), amount: form.get('amount'), by });
    return 'Collaboration requested: management approve it';
  });
}
export async function incentiveAction(form: FormData) {
  await act(form, '/partners/programs', async () => {
    const what = str(form, 'do', 20), by = orNull(str(form, 'by', 80));
    if (what === 'active' || what === 'ended') { await P.setIncentiveStatus(id(form), what, by); return what === 'active' ? 'Incentive active' : 'Incentive ended'; }
    if (what === 'award') { await P.awardIncentive(id(form), id(form, 'partner'), orNull(str(form, 'month', 7)), orNull(str(form, 'note')), by); return 'Incentive awarded'; }
    await P.createIncentive({ name: orNull(str(form, 'name', 120)), kind: str(form, 'kind', 20), minSales: form.get('minSales'), months: form.get('months'),
      categories: list(form, 'categories'), levels: list(form, 'levels').map(Number), startsOn: orNull(str(form, 'startsOn', 10)), endsOn: orNull(str(form, 'endsOn', 10)),
      reward: form.get('reward'), maxPayout: form.get('maxPayout'), entity: orNull(str(form, 'entity', 80)), notes: orNull(str(form, 'notes')), by });
    return 'Incentive saved: it stays off until someone else activates it';
  });
}
export async function personalPurchaseAction(form: FormData) {
  await act(form, '/partners/programs', async () => {
    const r = await P.recordPersonalPurchase(id(form, 'partner'), { voucher: orNull(str(form, 'voucher', 40)), purchaseOn: orNull(str(form, 'purchaseOn', 10)),
      value: form.get('value'), otp: form.get('otp') === 'on', note: orNull(str(form, 'note')), by: orNull(str(form, 'by', 80)) });
    return `Recorded: ${r.percent}% on ₹${r.eligible.toLocaleString('en-IN')} = ₹${r.discount.toLocaleString('en-IN')} discount; ₹${r.left.toLocaleString('en-IN')} left this year`;
  });
}
export async function entityAction(form: FormData) {
  await act(form, '/partners/programs', async () => { await P.setEntity(str(form, 'store', 40), orNull(str(form, 'entity', 80))); return 'Entity saved'; });
}
