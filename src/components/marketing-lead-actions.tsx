'use client';
import Link from 'next/link';
import { useState } from 'react';
import { nowLocal, OUTCOMES, recordCall, safeProductLink, STORES, uid, type Lead, type Outcome } from '@/lib/marketing/local';
import { button, card, Field, input, primary } from './marketing-shared';
export function LeadActions({ lead, update, variant = 'full' }: { lead: Lead; update: (lead: Lead) => boolean; variant?: 'full' | 'call-only' }) {
  const [mode, setMode] = useState<'call' | 'note' | 'followup' | 'visit' | null>(null);
  const [callLogged, setCallLogged] = useState(lead.interactions.some(i => i.type === 'call'));
  const [createFollowup, setCreateFollowup] = useState(false);
  const [error, setError] = useState('');
  function start(next: typeof mode) { setMode(next); setError(''); setCreateFollowup(false); }
  const whatsapp = `https://wa.me/${lead.phone.replace(/\D/g, '')}${safeProductLink(lead.productLink) ? `?text=${encodeURIComponent(`Hello ${lead.name}, here is the ${lead.product || 'product'} you asked about: ${lead.productLink}`)}` : ''}`;
  return <>
    <div className="flex flex-wrap gap-2">
      {variant === 'full' && <>
        <a href={`tel:${lead.phone}`} className={button}>Call</a>
        <a href={whatsapp} target="_blank" rel="noreferrer" className={button} onClick={() => update({ ...lead, interactions: [...lead.interactions, { id: uid(), at: nowLocal(), type: 'whatsapp', text: safeProductLink(lead.productLink) ? 'Opened WhatsApp with product link draft; sending is not confirmed.' : 'Opened WhatsApp; sending is not confirmed.' }] })}>WhatsApp</a>
        {lead.email ? <a className={button} href={`mailto:${encodeURIComponent(lead.email)}`} onClick={() => update({ ...lead, interactions: [...lead.interactions, { id: uid(), at: nowLocal(), type: 'email', text: 'Opened email draft; sending is not confirmed.' }] })}>Email</a> : <Link className={button} href={`/crm/marketing/leads/${lead.id}`}>Add email</Link>}
      </>}
      {variant === 'call-only' && <button className={callLogged ? 'rounded-xl border border-status-good/30 bg-status-good/10 px-3 py-2 text-xs font-medium text-status-good' : button} onClick={() => start('call')}>{callLogged ? 'Call logged' : 'Log call'}</button>}
      {variant === 'full' && <button className={button} onClick={() => start('visit')}>Store visit</button>}
    </div>
    {mode && <div role="dialog" aria-modal="true" aria-label={`${mode} for ${lead.name}`} className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/40 p-4" onKeyDown={e => { if (e.key === 'Escape') setMode(null); }}>
      <form className={`${card} max-h-[90vh] w-full max-w-xl overflow-y-auto shadow-xl`} onSubmit={e => {
        e.preventDefault(); const f = new FormData(e.currentTarget); const get = (key: string) => String(f.get(key) ?? '').trim(); const at = nowLocal();
        try {
          let next = lead;
          if (mode === 'call') next = recordCall(lead, { outcome: get('outcome') as Outcome, note: get('note'), intent: get('intent'), store: get('store'), product: get('product'), category: get('category'), productLink: '', due: '', salesperson: get('salesperson'), createFollowup }, at);
          if (mode === 'note') { if (!get('note')) throw new Error('Enter a note.'); next = { ...lead, interactions: [...lead.interactions, { id: uid(), at, type: 'note', text: get('note') }] }; }
          if (mode === 'followup') {
            if (!get('due') || get('due') <= at.slice(0, 16)) throw new Error('Choose a future follow-up time.');
            next = { ...lead, followups: [...lead.followups, { id: uid(), due: get('due'), note: get('note'), completedAt: null }], interactions: [...lead.interactions, { id: uid(), at, type: 'followup', text: `Follow-up scheduled for ${get('due').replace('T', ' ')}. ${get('note')}` }] };
          }
          if (mode === 'visit') next = { ...lead, preferredStore: get('store'), interactions: [...lead.interactions, { id: uid(), at, type: 'visit', text: `Visited ${get('store')}. ${get('note')}` }] };
          if (update(next)) { if (mode === 'call') setCallLogged(true); setMode(null); } else setError('Unable to save. Close this form and check the workspace message.');
        } catch (err) { setError(err instanceof Error ? err.message : 'Could not save'); }
      }}>
        <div className="mb-4 flex items-start justify-between gap-4"><div><h2 className="text-xl font-semibold text-ink">{mode === 'call' ? 'Record call outcome' : mode === 'note' ? 'Add a note' : mode === 'visit' ? 'Record store visit' : 'Schedule follow-up'}</h2><p className="mt-1 text-sm text-ink-2">{lead.name} · {lead.phone}</p></div><button type="button" className={button} onClick={() => setMode(null)}>Close</button></div>
        {mode === 'call' && <CallFields lead={lead} />}
        {mode === 'followup' && <Field label="Follow-up date and time (IST)"><input autoFocus required name="due" type="datetime-local" min={nowLocal().slice(0, 16)} className={input} /></Field>}
        {mode === 'visit' && <Field label="Visited store"><select name="store" required className={input} defaultValue={lead.preferredStore === 'Online' ? '' : lead.preferredStore}><option value="">Select store</option><option>MG</option><option>JAYNAGAR</option></select></Field>}
        <div className="mt-4"><Field label="Notes"><textarea autoFocus={mode === 'note'} name="note" required={mode === 'note'} rows={4} className={input} placeholder="What did the customer say? What should happen next?" /></Field></div>
        {mode === 'call' && <div className="mt-4"><Field label="Logged by"><select name="salesperson" required className={input} defaultValue="Abishek"><option>Abishek</option></select></Field></div>}
        {mode === 'call' && <button type="button" className={createFollowup ? 'mt-4 rounded-xl border border-status-good/30 bg-status-good/10 px-3 py-2 text-xs font-medium text-status-good' : `${button} mt-4`} onClick={() => setCreateFollowup(!createFollowup)}>{createFollowup ? 'Follow-up added' : 'Follow-up'}</button>}
        {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
        <button className={`${primary} mt-4`} type="submit">Save {mode === 'call' ? 'call outcome' : mode === 'visit' ? 'visit' : mode}</button>
      </form>
    </div>}
  </>;
}
function CallFields({ lead }: { lead: Lead }) {
  const [outcome, setOutcome] = useState<Outcome>('Connected / interested');
  const [store, setStore] = useState(lead.preferredStore);
  const interested = outcome === 'Connected / interested';
  return <div className="space-y-4">
    <Field label="Call outcome"><select autoFocus name="outcome" className={input} value={outcome} onChange={e => setOutcome(e.target.value as Outcome)}>{OUTCOMES.map(o => <option key={o}>{o}</option>)}</select></Field>
    <Field label={`Intent${interested ? ' *' : ''}`}><input name="intent" className={input} required={interested} defaultValue={lead.intent} placeholder="Occasion, need, budget, or purchase plan" /></Field>
    <Field label={`Preferred store${interested ? ' *' : ''}`}><select name="store" className={input} required={interested} value={store} onChange={e => setStore(e.target.value)}><option value="">Not decided</option>{STORES.map(s => <option key={s}>{s}</option>)}</select></Field>
    <div className="grid gap-3 sm:grid-cols-2"><Field label="Product"><input name="product" defaultValue={lead.product} className={input} required={interested && store === 'Online'} /></Field><Field label="Category"><input name="category" defaultValue={lead.category} className={input} required={interested && store === 'Online'} /></Field></div>
    <p className="text-xs text-ink-muted">Use the Follow-up button below to add this lead to the follow-up queue with the current IST time.</p>
  </div>;
}
