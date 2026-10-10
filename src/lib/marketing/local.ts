import { normalizePhone } from '@/lib/phone';

export const SOURCES = ['Meta ads', 'Google ads', 'Website', 'WhatsApp', 'Instagram DM', 'Influencer', 'Events', 'Referral', 'Walkin'] as const;
export const STORES = ['MG', 'JAYNAGAR', 'Online', 'Exhibition'] as const;
export const OUTCOMES = ['Connected / interested', 'Connected / follow-up required', 'Connected / not interested', 'No answer', 'Callback required', 'Wrong number'] as const;
export type Outcome = typeof OUTCOMES[number];
export type Acquisition = { source: string; campaignId: string; at: string; cost: number | null };
export type Interaction = { id: string; at: string; type: 'received' | 'call' | 'note' | 'followup' | 'whatsapp' | 'email' | 'visit' | 'profile'; text: string; outcome?: Outcome; by?: string };
export type Followup = { id: string; due: string; note: string; completedAt: string | null };
export type Lead = {
  id: string; phone: string; name: string; email: string; city: string;
  source: string; campaignId: string; preferredStore: string; date: string; acquiredAt: string;
  claimedBy?: string; claimedAt?: string;
  claimGroup?: string; sheetTabs?: string[];
  acquisitions: Acquisition[]; status: Outcome | 'New'; intent: string; product: string; category: string; productLink: string;
  interactions: Interaction[]; followups: Followup[];
};
export type Sale = { phone: string; invoice: string; amount: number | null; date: string; store: string };
export type Dataset = { version: 2; demo: boolean; leads: Lead[]; sales: Sale[] };
export type Kind = 'leads' | 'sales';
export type Mapping = Record<'phone' | 'name' | 'source' | 'invoice' | 'amount' | 'campaignId' | 'preferredStore' | 'date' | 'email' | 'city' | 'cost', string>;
export type Preview = { leads: Lead[]; sales: Sale[]; errors: { row: number; reason: string }[]; duplicates: number; updated: number };
export const EMPTY: Dataset = { version: 2, demo: false, leads: [], sales: [] };
export const uid = () => crypto.randomUUID();
export const nowLocal = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' }).replace(' ', 'T');

export function normalizeStore(value: string): string {
  const store = value.toUpperCase().replace(/[\s._-]/g, '');
  return ['MG', 'MGROAD'].includes(store) ? 'MG' : ['JAYNAGAR', 'JAYANAGAR'].includes(store) ? 'JAYNAGAR' : store === 'ONLINE' ? 'Online' : store === 'EXHIBITION' ? 'Exhibition' : '';
}
export function normalizeSource(value: string): string {
  const key = value.toLowerCase().replace(/[^a-z]/g, '');
  const aliases: Record<string, string> = { meta: 'Meta ads', facebook: 'Meta ads', facebookads: 'Meta ads', google: 'Google ads', instagram: 'Instagram DM', event: 'Events', walkin: 'Walkin' };
  return SOURCES.find(s => s.toLowerCase().replace(/[^a-z]/g, '') === key) ?? aliases[key] ?? '';
}
export function campaignTail(value: string): string {
  return value.split('|').at(-1)?.trim() ?? '';
}
export function parseLeadDate(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return '';
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}` : null;
  const raw = String(value).trim();
  if (!raw) return '';
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/);
  const indian = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[T ].*)?$/);
  if (!iso && !indian) return null;
  const [y, m, d] = iso ? [Number(iso[1]), Number(iso[2]), Number(iso[3])] : [Number(indian![3]), Number(indian![2]), Number(indian![1])];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null;
}
/** Local input times are India time; offset-bearing timestamps are converted to India time. */
export function parseDateTime(value: unknown): string | null {
  const day = parseLeadDate(value);
  if (day === null || !day) return day;
  if (value instanceof Date) return `${day}T${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}:${String(value.getSeconds()).padStart(2, '0')}`;
  const raw = String(value).trim();
  if (!/[T ]/.test(raw)) return day; // Preserve unknown time on legacy date-only records.
  const time = raw.match(/[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/);
  if (!time || Number(time[1]) > 23 || Number(time[2]) > 59 || Number(time[3] ?? 0) > 59) return null;
  const local = `${day}T${time[1]}:${time[2]}:${time[3] ?? '00'}`;
  if (!time[4]) return local;
  const stamp = new Date(local + time[4]);
  return Number.isFinite(stamp.getTime()) ? stamp.toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' }).replace(' ', 'T') : null;
}
export function makeLead(input: { phone: string; name: string; source: string; campaignId?: string; preferredStore?: string; acquiredAt?: string; email?: string; city?: string; cost?: number | null }): Lead {
  const at = input.acquiredAt ?? nowLocal();
  return { id: `LD-${uid()}`, phone: input.phone, name: input.name, email: input.email ?? '', city: input.city ?? '', source: input.source, campaignId: input.campaignId ?? '', preferredStore: input.preferredStore ?? '', date: at.slice(0, 10), acquiredAt: at,
    acquisitions: [{ source: input.source, campaignId: input.campaignId ?? '', at, cost: input.cost ?? null }], status: 'New', intent: '', product: '', category: '', productLink: '',
    interactions: [{ id: uid(), at, type: 'received', text: 'Lead received; added to marketing calling queue.' }], followups: [] };
}
export function demoData(): Dataset {
  const names = ['Asha Rao', 'Meera Shah', 'Kavya Nair', 'Priya Das', 'Neha Jain', 'Ritu Kumar', 'Anita Roy', 'Divya Sen', 'Pooja Patel', 'Sneha Rao', 'Nisha Gupta', 'Rekha Iyer'];
  const today = nowLocal().slice(0, 10);
  const leads = names.map((name, i) => {
    const lead = makeLead({ name: `${name} (Demo)`, phone: `+9190001234${i + 10}`, source: SOURCES[i % SOURCES.length], campaignId: `CAM-2026-${String(i % 3 + 1).padStart(3, '0')}`, preferredStore: i === 6 ? 'Online' : i % 2 ? 'JAYNAGAR' : 'MG', acquiredAt: `2026-09-${15 + i}T10:30:00`, email: `demo${i + 1}@example.com`, city: 'Bengaluru', cost: i < 8 ? 120 + i * 10 : null });
    lead.id = `LD-DEMO-${String(i + 1).padStart(4, '0')}`;
    lead.interactions[0].id = `demo-received-${i}`;
    if (i < 7) {
      lead.status = OUTCOMES[i % OUTCOMES.length];
      lead.interactions.push({ id: `demo-call-${i}`, at: `2026-09-${16 + i}T11:00:00`, type: 'call', outcome: lead.status, text: 'Demo call recorded by marketing.' });
    }
    if ([0, 6].includes(i)) { lead.intent = 'Looking for a silk saree for a family celebration'; lead.category = 'Sarees'; lead.product = 'Silk saree'; }
    if ([1, 4, 6].includes(i)) lead.followups.push({ id: `demo-followup-${i}`, due: `${today}T16:00`, note: 'Check preferences and help with the next step.', completedAt: null });
    if (i < 3) lead.interactions.push({ id: `demo-visit-${i}`, at: `2026-09-${18 + i}T14:00:00`, type: 'visit', text: `Visited ${lead.preferredStore}` });
    return lead;
  });
  return { version: 2, demo: true, leads, sales: [
    ...leads.slice(0, 4).map((l, i) => ({ phone: l.phone, invoice: `DEMO-${i + 1}`, amount: 2500 + i * 1500, date: `2026-09-${20 + i}T15:00:00`, store: l.preferredStore })),
    { phone: leads[0].phone, invoice: 'DEMO-5', amount: 1800, date: '2026-09-26T16:30:00', store: 'MG' },
    { phone: '+919000123499', invoice: 'DEMO-6', amount: 3200, date: '2026-09-27T12:00:00', store: 'JAYNAGAR' },
  ] };
}
export function guessMapping(headers: string[]): Mapping {
  const pick = (aliases: string[]) => headers.find(h => aliases.includes(h.toLowerCase().replace(/[^a-z0-9]/g, ''))) ?? '';
  return { phone: pick(['phone', 'number', 'mobile', 'mobilenumber', 'phonenumber', 'customerphone', 'contactnumber']), name: pick(['name', 'fullname', 'customername', 'leadname']), source: pick(['source', 'sources', 'leadsource', 'channel']), invoice: pick(['invoice', 'invoiceid', 'invoicenumber', 'billno', 'billnumber', 'billid']), campaignId: pick(['campaignid', 'campaign', 'campaigncode', 'campaignname']), preferredStore: pick(['preferredstore', 'preferedstore', 'prefferedstore', 'store', 'branch']), date: pick(['date', 'datetime', 'dateandtime', 'leaddate', 'acquiredat', 'createddate', 'createdat', 'createdtime', 'saledate', 'purchasedate']), amount: pick(['amount', 'salesamount', 'total', 'netamount', 'billamount', 'salesvalue']), email: pick(['email', 'emailaddress']), city: pick(['city']), cost: pick(['cost', 'costperlead', 'cpl', 'acquisitioncost']) };
}
const acquisitionKey = (a: Acquisition) => `${a.source}|${a.campaignId}|${a.at}`;
export function mergeLead(existing: Lead, incoming: Lead): Lead {
  const keys = new Set(existing.acquisitions.map(acquisitionKey));
  const added = incoming.acquisitions.filter(a => !keys.has(acquisitionKey(a)));
  return { ...existing, email: existing.email || incoming.email, city: existing.city || incoming.city, preferredStore: existing.preferredStore || incoming.preferredStore,
    acquisitions: [...existing.acquisitions, ...added],
    interactions: [...existing.interactions, ...added.map(a => ({ id: uid(), at: a.at, type: 'received' as const, text: `Additional acquisition: ${a.source}${a.campaignId ? ` · ${a.campaignId}` : ''}` }))] };
}
export function previewRows(rows: Record<string, unknown>[], kind: Kind, mapping: Mapping, data: Dataset): Preview {
  const result: Preview = { leads: [], sales: [], errors: [], duplicates: 0, updated: 0 };
  const leads = new Map(data.leads.map(l => [l.phone, l]));
  const changed = new Set<string>();
  const invoices = new Map(data.sales.map(s => [s.invoice, s]));
  for (const [index, row] of rows.entries()) {
    if (Object.values(row).every(v => v === '' || v === null || v === undefined)) continue;
    const fail = (reason: string) => result.errors.push({ row: index + 2, reason });
    const get = (key: keyof Mapping) => String(row[mapping[key]] ?? '').trim();
    const phone = normalizePhone(row[mapping.phone]);
    if (!phone.ok || phone.hadMultiple) { fail('Use one valid Indian mobile number'); continue; }
    const at = parseDateTime(row[mapping.date]);
    if (at === null) { fail('Invalid date/time. Use YYYY-MM-DD HH:mm or DD/MM/YYYY HH:mm'); continue; }
    const store = normalizeStore(get('preferredStore'));
    if (get('preferredStore') && !store) { fail('Store must be MG, JAYNAGAR, Online, or Exhibition'); continue; }
    if (kind === 'leads') {
      const sources = [...new Set(get('source').split(/[,;|]/).map(normalizeSource))];
      if (!get('name') || !sources.length || sources.some(s => !s)) { fail('Name and a supported source are required'); continue; }
      if (get('email') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(get('email'))) { fail('Invalid email address'); continue; }
      const cost = get('cost') ? Number(get('cost').replace(/[₹,\s]/g, '')) : null;
      if (cost !== null && (!Number.isFinite(cost) || cost < 0)) { fail('Cost per lead must be zero or positive'); continue; }
      const existing = leads.get(phone.e164);
      const acquiredAt = at || existing?.acquiredAt || nowLocal();
      const lead = makeLead({ phone: phone.e164, name: get('name'), source: sources[0], campaignId: get('campaignId'), preferredStore: store, acquiredAt, email: get('email'), city: get('city'), cost });
      lead.acquisitions = sources.map((source, i) => ({ source, campaignId: lead.campaignId, at: acquiredAt, cost: i === 0 ? cost : null }));
      if (existing) {
        const merged = mergeLead(existing, lead);
        if (JSON.stringify({ ...merged, interactions: [] }) === JSON.stringify({ ...existing, interactions: [] })) { result.duplicates++; continue; }
        leads.set(phone.e164, merged);
      } else leads.set(phone.e164, lead);
      changed.add(phone.e164);
    } else {
      const invoice = get('invoice');
      const amount = get('amount') ? Number(get('amount').replace(/[₹,\s]/g, '')) : null;
      if (!invoice) { fail('Invoice / bill ID is required'); continue; }
      if (amount !== null && (!Number.isFinite(amount) || amount <= 0)) { fail('Sale amount must be positive or blank'); continue; }
      const sale = { phone: phone.e164, invoice, amount, date: at, store };
      const previous = invoices.get(invoice);
      if (previous) {
        if (JSON.stringify(previous) !== JSON.stringify(sale)) fail(`Invoice ${invoice} already exists with different details`);
        else result.duplicates++;
        continue;
      }
      invoices.set(invoice, sale); result.sales.push(sale);
    }
  }
  result.leads = [...changed].map(phone => leads.get(phone)!);
  result.updated = result.leads.filter(l => data.leads.some(old => old.phone === l.phone)).length;
  return result;
}
export function commitPreview(data: Dataset, preview: Preview): Dataset {
  const leads = new Map(data.leads.map(l => [l.phone, l]));
  for (const lead of preview.leads) leads.set(lead.phone, lead);
  return { ...data, leads: [...leads.values()], sales: [...data.sales, ...preview.sales] };
}
export function convertedLeads(data: Dataset) {
  const byPhone = new Map<string, Sale[]>();
  for (const sale of data.sales) byPhone.set(sale.phone, [...(byPhone.get(sale.phone) ?? []), sale]);
  return data.leads.filter(l => byPhone.has(l.phone)).map(l => ({ ...l, sales: byPhone.get(l.phone)! }));
}
/** A lead leaves every calling queue as soon as its first call is logged. */
export function hasLoggedCall(lead: Lead): boolean {
  return lead.interactions.some(interaction => interaction.type === 'call');
}
export type LeadFilters = { from: string; to: string; store: string; source: string; search: string };
export function filterLeads(leads: Lead[], filters: LeadFilters): Lead[] {
  return leads.filter(l => (!filters.store || l.preferredStore === filters.store) && (!filters.source || l.acquisitions.some(a => a.source === filters.source)) && (!filters.from || (!!l.date && l.date >= filters.from)) && (!filters.to || (!!l.date && l.date <= filters.to)) && `${l.id} ${l.name} ${l.phone} ${l.email} ${l.acquisitions.map(a => `${a.source} ${a.campaignId}`).join(' ')}`.toLowerCase().includes(filters.search.toLowerCase()));
}
export function metrics(data: Dataset, leads = data.leads) {
  const phones = new Set(leads.map(l => l.phone));
  const sales = data.sales.filter(s => phones.has(s.phone));
  const converted = new Set(sales.map(s => s.phone)).size;
  const costs = leads.flatMap(l => l.acquisitions).filter(a => a.cost !== null);
  const spend = costs.reduce((n, a) => n + (a.cost ?? 0), 0);
  return { total: leads.length, contacted: leads.filter(l => l.interactions.some(i => i.type === 'call' && i.outcome?.startsWith('Connected'))).length, interested: leads.filter(l => l.status === 'Connected / interested').length, visits: leads.filter(l => l.interactions.some(i => i.type === 'visit')).length, converted, revenue: sales.reduce((n, s) => n + (s.amount ?? 0), 0), conversion: leads.length ? converted / leads.length * 100 : 0, cpa: costs.length && converted ? spend / converted : null, spend, costsKnown: costs.length, costsTotal: leads.flatMap(l => l.acquisitions).length, orders: sales.length };
}
export function recordCall(lead: Lead, input: { outcome: Outcome; note: string; intent: string; store: string; product: string; category: string; productLink: string; due: string; salesperson?: string; createFollowup?: boolean }, at = nowLocal()): Lead {
  if (!OUTCOMES.includes(input.outcome)) throw new Error('Choose a call outcome.');
  if (!input.salesperson?.trim()) throw new Error('Choose who logged the call.');
  if (input.outcome === 'Connected / interested' && !input.store) throw new Error('Interested leads need a preferred store.');
  if (input.outcome === 'Connected / interested' && input.store === 'Online' && (!input.product.trim() || !input.category.trim())) throw new Error('Online interest needs a product and category.');
  if (input.due && (!parseDateTime(input.due) || input.due <= at.slice(0, 16))) throw new Error('Follow-up must be in the future.');
  const followups = lead.followups.map(f => f.completedAt ? f : { ...f, completedAt: at });
  const due = input.due;
  if (due) followups.push({ id: uid(), due, note: input.note.trim() || input.outcome, completedAt: null });
  const note = input.note.trim() || input.outcome;
  return { ...lead, status: input.outcome, intent: input.intent.trim(), preferredStore: input.store, product: input.product.trim(), category: input.category.trim(), productLink: input.productLink.trim(), followups,
    interactions: [...lead.interactions, { id: uid(), at, type: 'call', outcome: input.outcome, by: input.salesperson.trim(), text: `${note} · Logged by ${input.salesperson.trim()}` }, ...(due ? [{ id: uid(), at, type: 'followup' as const, text: `Follow-up added for ${due.replace('T', ' ')}` }] : [])] };
}
export function safeProductLink(value: string): boolean { try { return new URL(value).protocol === 'https:'; } catch { return false; } }
export function readDataset(raw: string): Dataset {
  const value = JSON.parse(raw);
  if (![1, 2].includes(value?.version) || typeof value.demo !== 'boolean' || !Array.isArray(value.leads) || !Array.isArray(value.sales)) throw new Error('Invalid local data');
  const demo = value.version === 1 && value.demo ? demoData() : null;
  const leads: Lead[] = value.leads.map((l: Lead) => {
    if (!l || typeof l.name !== 'string' || typeof l.phone !== 'string' || typeof l.source !== 'string') throw new Error('Invalid lead');
    if (value.version === 2) {
      if (!l.id || !Array.isArray(l.acquisitions) || !Array.isArray(l.interactions) || !Array.isArray(l.followups)) throw new Error('Invalid lead history');
      return l;
    }
    const seed = demo?.leads.find(d => d.phone === l.phone && d.name === l.name);
    const source = normalizeSource(l.source) || l.source;
    const lead = seed ?? makeLead({ phone: l.phone, name: l.name, source, campaignId: l.campaignId ?? '', preferredStore: l.preferredStore ?? '', acquiredAt: l.date ?? '' });
    return { ...lead, campaignId: l.campaignId ?? lead.campaignId, preferredStore: l.preferredStore ?? lead.preferredStore, date: l.date ?? lead.date, acquiredAt: l.date || lead.acquiredAt, source, acquisitions: [{ ...lead.acquisitions[0], source, campaignId: l.campaignId ?? lead.campaignId, at: l.date || lead.acquiredAt }] };
  });
  const phones = new Set(leads.map(l => l.phone));
  if (phones.size !== leads.length || new Set(leads.map(l => l.id)).size !== leads.length) throw new Error('Duplicate local identity');
  const sales: Sale[] = value.sales.map((s: Sale) => {
    if (!s || typeof s.phone !== 'string' || typeof s.invoice !== 'string' || !(s.amount === null || (typeof s.amount === 'number' && Number.isFinite(s.amount)))) throw new Error('Invalid sale');
    const seed = demo?.sales.find(d => d.invoice === s.invoice && d.phone === s.phone);
    return { ...s, date: s.date ?? seed?.date ?? '', store: s.store ?? seed?.store ?? '' };
  });
  return { version: 2, demo: value.demo, leads, sales };
}

export type CallEntry = { id: string; at: string; salesperson: string; outcome: Outcome | ''; note: string; leadId: string; name: string; phone: string };
export type SalespersonPerformance = { salesperson: string; claimed: number; called: number; pending: number; interested: number; converted: number; revenue: number };

export function salespersonPerformance(data: Dataset, calls: CallEntry[], salespeople: string[]): SalespersonPerformance[] {
  return salespeople.map(salesperson => {
    const personCalls = calls.filter(call => call.salesperson === salesperson).sort((a, b) => b.at.localeCompare(a.at));
    const calledIds = new Set(personCalls.map(call => call.leadId));
    const claimedLeads = data.leads.filter(lead => lead.claimedBy === salesperson);
    const claimedPhones = new Set(claimedLeads.map(lead => lead.phone));
    const convertedPhones = new Set(data.sales.filter(sale => claimedPhones.has(sale.phone)).map(sale => sale.phone));
    return {
      salesperson,
      claimed: claimedLeads.length,
      called: claimedLeads.filter(lead => calledIds.has(lead.id)).length,
      pending: claimedLeads.filter(lead => !calledIds.has(lead.id)).length,
      interested: claimedLeads.filter(lead => lead.status === 'Connected / interested').length,
      converted: convertedPhones.size,
      revenue: data.sales.filter(sale => claimedPhones.has(sale.phone)).reduce((total, sale) => total + (sale.amount ?? 0), 0),
    };
  });
}
/** Every logged call across the given datasets, newest first. Older records only carry the name in the text, so fall back to that. */
export function callLog(datasets: Dataset[], stored: CallEntry[] = []): CallEntry[] {
  const seen = new Set<string>(stored.map(c => c.id));
  const entries: CallEntry[] = [...stored];
  for (const d of datasets) for (const lead of d.leads) for (const i of lead.interactions) {
    if (i.type !== 'call' || seen.has(i.id)) continue;
    seen.add(i.id);
    const m = i.text.match(/^([\s\S]*?)(?: · Logged by (.+))?$/);
    entries.push({ id: i.id, at: i.at, salesperson: i.by ?? m?.[2] ?? 'Unknown', outcome: i.outcome ?? '', note: m?.[1] ?? i.text, leadId: lead.id, name: lead.name, phone: lead.phone });
  }
  return entries.sort((a, b) => b.at.localeCompare(a.at));
}
/** Calls in a dataset that belong in the shared database (demo records are excluded). */
export function callsForSync(d: Dataset) {
  return callLog([d]).filter(c => !c.id.startsWith('demo-')).map(c => ({ id: c.id, leadId: c.leadId, leadName: c.name, phone: c.phone, salesperson: c.salesperson, outcome: c.outcome || undefined, note: c.note, at: c.at.slice(0, 19) }));
}
