/**
 * Customer table — Instagram and WhatsApp leads.
 *
 * Server-paginated. Every row shows *both* of its channel touches where it has
 * them, not just the attributed one — a row reading only "Instagram" would hide
 * that the same person was also on the WhatsApp broadcast. 198 people are on
 * both lists. (D-79)
 *
 * Empty values render "Not provided" rather than a blank cell: 535 customers
 * have no city and most have no date of birth, and a blank cell reads as a bug
 * where an explicit label reads as a fact. (D-80)
 */

'use client';

import { useState } from 'react';
import {
  formatCurrency,
  formatNumber,
  formatPhone,
  formatDate,
  formatDateTime,
  orNotProvided,
  CHANNEL_LABEL,
  LIFECYCLE_BASIS_LABEL,
  REMARK_LABEL,
} from '@/lib/format';
import type { CustomerRow } from '@/lib/queries/customers';

function Chip({
  children,
  tone = 'neutral',
  title,
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'soft' | 'weak';
  title?: string;
}) {
  const tones = {
    neutral: 'bg-inset text-ink-2 border-line',
    soft: 'bg-accent-soft/40 text-ink border-transparent',
    // A classification resting on the weakest evidence must not look identical
    // to a provable one. (D-81)
    weak: 'bg-inset text-ink-muted border-dashed border-current/30',
  }[tone];

  return (
    <span
      title={title}
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${tones}`}
    >
      {children}
    </span>
  );
}

function LifecycleChip({ row }: { row: CustomerRow }) {
  if (row.lifecycle === 'existing') {
    const inferred = row.lifecycleBasis === 'no_lead_match';
    return (
      <Chip
        tone={inferred ? 'weak' : 'neutral'}
        title={row.lifecycleBasis ? LIFECYCLE_BASIS_LABEL[row.lifecycleBasis] : undefined}
      >
        Existing{inferred ? ' ?' : ''}
      </Chip>
    );
  }
  return <Chip tone="soft">New</Chip>;
}

function DetailField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-[0.09em] text-ink-muted">
        {label}
      </p>
      <p className="mt-1 text-sm text-ink">{value}</p>
    </div>
  );
}

function Row({ row }: { row: CustomerRow }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <tr className="border-t border-grid hover:bg-inset/60">
        <td className="px-4 py-3">
          <p className="font-medium text-ink">{orNotProvided(row.fullName)}</p>
          <p className="text-xs text-ink-muted">{row.email ?? 'No email'}</p>
        </td>
        <td className="px-4 py-3">
          {row.storeName ? (
            <Chip>{row.storeName}</Chip>
          ) : (
            <span className="text-sm text-ink-muted">Not provided</span>
          )}
        </td>
        <td className="tnum px-4 py-3 text-sm text-ink">{formatPhone(row.phoneE164)}</td>
        <td className="px-4 py-3">
          <div className="flex flex-wrap gap-1">
            {row.channels.length === 0 ? (
              <Chip tone="weak">No lead record</Chip>
            ) : (
              row.channels.map((c) => (
                <Chip key={c} tone={c === row.primaryChannel ? 'soft' : 'neutral'}>
                  {CHANNEL_LABEL[c] ?? c}
                </Chip>
              ))
            )}
          </div>
        </td>
        <td className="px-4 py-3">
          <LifecycleChip row={row} />
        </td>
        <td className="tnum px-4 py-3 text-right text-sm font-medium text-ink">
          {row.billCount > 0 ? formatCurrency(row.totalSales) : '—'}
        </td>
        <td className="px-4 py-3 text-right">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-2 hover:bg-inset"
          >
            {open ? 'Hide' : 'View'}
          </button>
        </td>
      </tr>

      {open && (
        <tr className="border-t border-grid bg-inset/40">
          <td colSpan={7} className="px-4 py-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <DetailField label="Area" value={orNotProvided(row.area)} />
              <DetailField label="City" value={orNotProvided(row.city)} />
              <DetailField label="Date of birth" value={formatDate(row.dateOfBirth)} />
              <DetailField label="Anniversary" value={formatDate(row.anniversary)} />

              <DetailField
                label="Campaigns"
                value={
                  row.campaigns.length ? (
                    <span className="flex flex-wrap gap-1">
                      {row.campaigns.map((c) => (
                        <Chip key={c}>{c.replace('Varamahalakshmi — ', '')}</Chip>
                      ))}
                    </span>
                  ) : (
                    'Not provided'
                  )
                }
              />
              <DetailField
                label="Bills"
                value={
                  row.billCount
                    ? `${formatNumber(row.billCount)} · ${formatCurrency(row.totalSales)}`
                    : 'No purchase'
                }
              />
              <DetailField
                label="Follow-up"
                value={
                  row.finalRemark
                    ? `${REMARK_LABEL[row.finalRemark] ?? row.finalRemark}${
                        row.call1Made === true ? ' · called' : ''
                      }`
                    : row.call1Made === true
                      ? 'Called, no outcome recorded'
                      : 'Not yet called'
                }
              />

              <DetailField
                label="First touch"
                value={
                  row.firstTouchAt ? (
                    <>
                      {formatDateTime(row.firstTouchAt)}
                      {row.touchEstimated && (
                        <span
                          className="ml-2 text-xs text-ink-muted"
                          title="No per-lead date in the source; the campaign start date is used instead."
                        >
                          estimated
                        </span>
                      )}
                    </>
                  ) : (
                    'No lead record'
                  )
                }
              />
              <DetailField label="First purchase" value={formatDateTime(row.firstSaleAt)} />
              <DetailField
                label="Classified as"
                value={
                  row.lifecycleBasis
                    ? LIFECYCLE_BASIS_LABEL[row.lifecycleBasis] ?? row.lifecycleBasis
                    : 'Not yet classified'
                }
              />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function CustomerTable({ rows }: { rows: CustomerRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="border-t border-grid px-4 py-16 text-center">
        <p className="text-sm font-medium text-ink">No customers match these filters</p>
        <p className="mt-1 text-sm text-ink-muted">
          Try clearing the search or widening a filter.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[64rem] text-left">
        <thead>
          <tr className="text-[11px] uppercase tracking-[0.09em] text-ink-muted">
            <th className="px-4 pb-3 font-medium">Customer</th>
            <th className="px-4 pb-3 font-medium">Store</th>
            <th className="px-4 pb-3 font-medium">Contact</th>
            <th className="px-4 pb-3 font-medium">Channels</th>
            <th className="px-4 pb-3 font-medium">Lifecycle</th>
            <th className="px-4 pb-3 text-right font-medium">Sales</th>
            <th className="px-4 pb-3" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <Row key={row.id} row={row} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
