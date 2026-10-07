'use client';

import { useSetParam } from './filters';
import { formatDateTime, formatNumber, formatPhone, orNotProvided } from '@/lib/format';
import type { StoreVisitRow } from '@/lib/queries/store-visits';

const control = 'rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent/40';

export function StoreVisitsTable({ rows, total, page, pageCount }: {
  rows: StoreVisitRow[]; total: number; page: number; pageCount: number;
}) {
  const { setParam, params, pending } = useSetParam();
  return <>
    <div className={`flex flex-wrap items-center gap-2 border-b border-grid px-4 py-3 ${pending ? 'opacity-70' : ''}`}>
      <input type="search" defaultValue={params.get('q') ?? ''} placeholder="Search customer, phone, visit ID or Driver ID"
        onChange={(e) => {
          const value = e.target.value;
          clearTimeout((window as unknown as { __sv?: number }).__sv);
          (window as unknown as { __sv?: number }).__sv = window.setTimeout(() => setParam({ q: value || null }), 300);
        }} className={`${control} min-w-[16rem] flex-1`} />
      <select value={params.get('status') ?? ''} onChange={(e) => setParam({ status: e.target.value || null })} className={control}>
        <option value="">All visits</option><option value="active">Active</option><option value="deleted">Deleted</option>
      </select>
      <select value={params.get('pageSize') ?? '50'} onChange={(e) => setParam({ pageSize: e.target.value })} className={control}>
        {[25, 50, 100].map((n) => <option key={n} value={n}>{n} per page</option>)}
      </select>
      <span className="tnum text-sm text-ink-muted">{formatNumber(total)} visits</span>
    </div>
    <div className="overflow-x-auto">
      <table className="w-full min-w-[68rem] text-sm">
        <thead className="bg-inset text-left text-[11px] font-bold uppercase text-ink-muted"><tr>
          <th className="px-4 py-3">Visited</th><th className="px-4 py-3">Store</th><th className="px-4 py-3">Customer</th>
          <th className="px-4 py-3">Visit details</th><th className="px-4 py-3">Driver ID</th><th className="px-4 py-3">Status</th>
        </tr></thead>
        <tbody>{rows.map((visit) => <tr key={visit.id} className="border-t border-grid align-top">
          <td className="tnum whitespace-nowrap px-4 py-3 text-ink">{formatDateTime(visit.visitedAt)}{visit.stoppedAt && <div className="mt-1 text-xs text-ink-muted">Ended {formatDateTime(visit.stoppedAt)}</div>}</td>
          <td className="px-4 py-3 text-ink">{visit.store}</td>
          <td className="px-4 py-3"><div className="font-medium text-ink">{orNotProvided(visit.customer)}</div><div className="text-xs text-ink-2">{formatPhone(visit.phone)}</div>{visit.externalCustomerRef && <div className="text-xs text-ink-muted">Contact No. {visit.externalCustomerRef}</div>}</td>
          <td className="px-4 py-3 text-ink"><div>{orNotProvided(visit.shoppingIntent)}</div><div className="mt-1 text-xs text-ink-muted">{formatNumber(visit.people)} people{visit.staffConverted ? ' · staff converted' : ''}{visit.source ? ` · ${visit.source}` : ''}</div><div className="text-xs text-ink-muted">ID {visit.externalId}</div></td>
          <td className="px-4 py-3 text-ink">{orNotProvided(visit.driverCode)}</td>
          <td className="px-4 py-3">{visit.deletedAt ? <span className="text-status-critical">Deleted</span> : <span className="text-status-positive">Active</span>}</td>
        </tr>)}
        {!rows.length && <tr><td colSpan={6} className="px-4 py-12 text-center text-sm text-ink-muted">No visits match these filters.</td></tr>}
        </tbody>
      </table>
    </div>
    <div className="flex items-center justify-between border-t border-grid px-4 py-3 text-sm">
      <span className="tnum text-ink-muted">Page {page} of {pageCount}</span>
      <div className="flex gap-2">
        <button type="button" disabled={page <= 1} onClick={() => setParam({ page: String(page - 1) })} className="rounded-lg border border-line px-3 py-1.5 text-ink disabled:opacity-40">Previous</button>
        <button type="button" disabled={page >= pageCount} onClick={() => setParam({ page: String(page + 1) })} className="rounded-lg border border-line px-3 py-1.5 text-ink disabled:opacity-40">Next</button>
      </div>
    </div>
  </>;
}
