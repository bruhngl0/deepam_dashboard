import { makeLead, uid, type Lead } from './local';
import { EXHB_TAG } from './sheet-routing';

export type ExhibitionRsvp = { phone: string; name: string; visitDay: string; visitSlot: string; partySize: number | null };

const FOLLOWUP_PREFIX = 'exhb-';
const istAt = (time: Date) => time.toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' }).replace(' ', 'T');

/**
 * The lead for someone who registered a visit on the public exhibition form:
 * tagged EXHB, with an open follow-up due in an hour so the team calls to
 * confirm. A known lead keeps its history, sources and owner; registering
 * again updates the one open exhibition follow-up instead of stacking another.
 */
export function withExhibitionRsvp(existing: Lead | null, rsvp: ExhibitionRsvp, now = new Date()): Lead {
  const at = istAt(now);
  const visit = [rsvp.visitDay, rsvp.visitSlot, rsvp.partySize ? `${rsvp.partySize} ${rsvp.partySize === 1 ? 'person' : 'people'}` : ''].filter(Boolean).join(' · ');
  const note = `Exhibition visit registered${visit ? `: ${visit}` : ''}. Call to confirm.`;
  const lead = existing ?? makeLead({ phone: rsvp.phone, name: rsvp.name, source: 'Events', preferredStore: 'Exhibition', acquiredAt: at });
  const followup = { id: `${FOLLOWUP_PREFIX}${uid()}`, due: istAt(new Date(now.getTime() + 60 * 60 * 1000)).slice(0, 16), note, completedAt: null };
  const open = lead.followups.find(f => f.id.startsWith(FOLLOWUP_PREFIX) && !f.completedAt);
  return {
    ...lead,
    preferredStore: lead.preferredStore || 'Exhibition',
    visitDay: rsvp.visitDay || lead.visitDay,
    visitSlot: rsvp.visitSlot || lead.visitSlot,
    tags: [...new Set([...(lead.tags ?? []), EXHB_TAG])],
    followups: open ? lead.followups.map(f => f.id === open.id ? { ...f, note } : f) : [...lead.followups, followup],
    interactions: [...lead.interactions, { id: uid(), at, type: 'followup', text: `${note.replace(' Call to confirm.', '')} Submitted on the exhibition form as ${rsvp.name}.` }],
  };
}
