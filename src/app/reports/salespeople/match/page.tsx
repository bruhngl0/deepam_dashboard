/**
 * Salesperson matching: every name or code the apps use for a salesperson, and the Salesperson ID
 * (EMP-) it belongs to. Most match automatically by name; this page fixes the rest by hand.
 * Manual matches are kept through every refresh.
 */

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { aq } from '@/lib/analytics/db';
import { refreshAnalytics } from '@/lib/analytics/refresh';
import { addSalesperson, matchAlias, salespersonAliases, salespersonRoster, SOURCE_LABEL, type Alias, type Salesperson } from '@/lib/analytics/salespeople';
import { formatNumber } from '@/lib/format';
import { Card, ReportShell, Table } from '../../report-shell';

export const dynamic = 'force-dynamic';
const PATH = '/reports/salespeople/match';

async function afterChange() {
  await refreshAnalytics().catch((error) => console.error('[salesperson match] refresh', error instanceof Error ? error.message : error));
  revalidatePath(PATH);
}

async function match(form: FormData) {
  'use server';
  await requireUser();
  const emp = String(form.get('emp') ?? '');
  if (emp === 'new') await addSalesperson(form.get('display'), form.get('store'), { source: form.get('source'), key: form.get('key') });
  else await matchAlias(form.get('source'), form.get('key'), emp === '' ? null : emp);
  await afterChange();
}

async function add(form: FormData) {
  'use server';
  await requireUser();
  await addSalesperson(form.get('name'), form.get('store'));
  await afterChange();
}

const select = 'rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink';
const button = 'rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink hover:bg-inset';

function MatchForm({ alias, roster, stores }: { alias: Alias; roster: Salesperson[]; stores: { store_code: string; name: string }[] }) {
  const storeGuess = alias.source === 'walktrack' ? alias.key.split(':')[0] : '';
  return (
    <form action={match} className="flex flex-wrap items-center justify-end gap-2">
      <input type="hidden" name="source" value={alias.source} />
      <input type="hidden" name="key" value={alias.key} />
      <input type="hidden" name="display" value={alias.display} />
      <label className="sr-only" htmlFor={`emp-${alias.source}-${alias.key}`}>Salesperson for {alias.display}</label>
      <select id={`emp-${alias.source}-${alias.key}`} name="emp" defaultValue={alias.emp_code ?? ''} className={select}>
        <option value="">Not matched</option>
        {roster.map((s) => <option key={s.emp_code} value={s.emp_code}>{s.emp_code} · {s.name}{s.store_code ? ` (${s.store_code})` : ''}</option>)}
        <option value="new">New salesperson: {alias.display}</option>
      </select>
      <label className="sr-only" htmlFor={`store-${alias.source}-${alias.key}`}>Store, for a new salesperson</label>
      <select id={`store-${alias.source}-${alias.key}`} name="store" defaultValue={storeGuess} className={select}>
        <option value="">Store (for a new salesperson)</option>
        {stores.map((s) => <option key={s.store_code} value={s.store_code}>{s.store_code} · {s.name}</option>)}
      </select>
      <button className={button}>Save</button>
    </form>
  );
}

export default async function SalespersonMatchPage() {
  await requireUser();
  const [roster, aliases, stores] = await Promise.all([
    salespersonRoster().catch(() => null),
    salespersonAliases().catch(() => null),
    aq<{ store_code: string; name: string }>('SELECT store_code, name FROM analytics.dim_store ORDER BY store_code').catch(() => null),
  ]);
  const people = roster ?? [];
  const all = aliases ?? [];
  const unmatched = all.filter((a) => !a.emp_code);
  const matched = all.filter((a) => a.emp_code);
  const nameOf = new Map(people.map((s) => [s.emp_code, s.name]));
  const aliasRow = (a: Alias, withStatus: boolean) => [
    <span key="n">{a.display}{a.display !== a.key && <span className="block text-xs font-normal text-ink-muted">{a.key}</span>}</span>,
    SOURCE_LABEL[a.source],
    a.source === 'walktrack' ? '—' : formatNumber(a.seen_count),
    ...(withStatus ? [a.matched_by === 'manual' ? `By hand · ${nameOf.get(a.emp_code!) ?? a.emp_code}` : `By name · ${nameOf.get(a.emp_code!) ?? a.emp_code}`] : []),
    <MatchForm key="f" alias={a} roster={people} stores={stores ?? []} />,
  ];

  return (
    <ReportShell
      title="Salesperson matching"
      current={PATH}
      intro="Each salesperson has one Salesperson ID (EMP-), so their walk-ins, bills, calls and driver visits add up across the apps. Names that match exactly one salesperson are matched by name; match the rest here. Matches made by hand are kept."
    >
      <Card title={`Not matched yet · ${formatNumber(unmatched.length)}`} note="Times seen = bills, calls or driver visits that carry this name.">
        <Table head={['Name or code', 'Where it comes from', 'Times seen', 'Salesperson']} rows={unmatched.map((a) => aliasRow(a, false))} empty="Every name is matched." minWidth="56rem" />
      </Card>

      <Card title={`Salespeople · ${formatNumber(people.length)}`} note="Everyone on WalkTrack is added automatically. Add someone who is not on WalkTrack here.">
        <Table head={['Salesperson', 'Salesperson ID', 'Store', 'Names matched']} rows={people.map((s) => [s.name, s.emp_code, s.store_code ?? '—', formatNumber(s.names)])} empty="No salespeople yet." />
        <form action={add} className="flex flex-wrap items-center gap-2 border-t border-grid px-4 py-3">
          <label className="text-sm text-ink-2" htmlFor="new-name">Add salesperson</label>
          <input id="new-name" name="name" required maxLength={120} placeholder="Name" className={select} />
          <label className="sr-only" htmlFor="new-store">Store</label>
          <select id="new-store" name="store" defaultValue="" className={select}>
            <option value="">Store</option>
            {(stores ?? []).map((s) => <option key={s.store_code} value={s.store_code}>{s.store_code} · {s.name}</option>)}
          </select>
          <button className={button}>Add</button>
        </form>
      </Card>

      <Card title={`Matched · ${formatNumber(matched.length)}`}>
        <details>
          <summary className="cursor-pointer px-4 py-3 text-sm text-ink-2">Show matched names</summary>
          <Table head={['Name or code', 'Where it comes from', 'Times seen', 'Matched', 'Change']} rows={matched.map((a) => aliasRow(a, true))} minWidth="64rem" />
        </details>
      </Card>
    </ReportShell>
  );
}
