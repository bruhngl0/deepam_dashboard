import { makeLead, uid, type Lead } from '@/lib/marketing/local';

export const PARTNER_TAG = 'partner';
const FOLLOWUP_PREFIX = 'partner-';
const istAt = (time: Date) => time.toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' }).replace(' ', 'T');
const dayLabel = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

export type PartnerReferralLead = {
  phone: string; name: string; partnerCode: string; partnerName: string; partnerCategory: string;
  occasion: string; store: string; storeLabel: string; appointmentDate: string;
};

/**
 * The Marketing Intelligence lead for a customer registered on a partner's referral link: source Referral, campaign
 * = the Partner ID (so Marketing's campaign conversions show each partner), tagged "partner", with an open
 * follow-up due in an hour so the team calls to confirm the appointment. A known lead keeps its history and owner,
 * gains a Referral acquisition, and registering again updates the one open partner follow-up instead of stacking.
 */
export function withPartnerReferral(existing: Lead | null, ref: PartnerReferralLead, now = new Date()): Lead {
  const at = istAt(now);
  const visit = `${ref.storeLabel}, ${dayLabel(ref.appointmentDate)}`;
  const note = `Partner referral from ${ref.partnerCode} (${ref.partnerName}, ${ref.partnerCategory}). ${ref.occasion} shopping; would like to visit ${visit}. Call to confirm the appointment.`;
  const lead = existing ?? makeLead({ phone: ref.phone, name: ref.name, source: 'Referral', campaignId: ref.partnerCode, preferredStore: ref.store, acquiredAt: at });
  const acquired = lead.acquisitions.some((a) => a.source === 'Referral' && a.campaignId === ref.partnerCode);
  const followup = { id: `${FOLLOWUP_PREFIX}${uid()}`, due: istAt(new Date(now.getTime() + 60 * 60 * 1000)).slice(0, 16), note, completedAt: null };
  const open = lead.followups.find((f) => f.id.startsWith(FOLLOWUP_PREFIX) && !f.completedAt);
  return {
    ...lead,
    name: lead.name || ref.name,
    preferredStore: lead.preferredStore || ref.store,
    visitDay: dayLabel(ref.appointmentDate),
    intent: lead.intent || ref.occasion,
    tags: [...new Set([...(lead.tags ?? []), PARTNER_TAG])],
    acquisitions: acquired ? lead.acquisitions : [...lead.acquisitions, { source: 'Referral', campaignId: ref.partnerCode, at, cost: null }],
    followups: open ? lead.followups.map((f) => (f.id === open.id ? { ...f, note } : f)) : [...lead.followups, followup],
    interactions: [...lead.interactions, { id: uid(), at, type: 'received', text: `Registered on ${ref.partnerCode}'s partner link as ${ref.name}: ${ref.occasion}, ${visit}.` }],
  };
}
