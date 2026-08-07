/**
 * Bulk import — drag a file onto each channel you have (Meta, WhatsApp,
 * Google Ads, Others) plus, optionally, a sales report, then hit Submit once.
 *
 * Each zone previews itself the moment a file lands (same auto-preview
 * behavior as the single-file forms above), so by the time Submit is
 * pressed every populated zone has already been read and reports its own
 * new/existing/rejected counts. Submit then commits every zone that has a
 * file, sequentially, and shows one combined result. Nothing commits for a
 * zone left empty.
 *
 * Dedup by phone is not something this form implements — it's the standing
 * behavior of `commitChannelLeads` / `commitSalesImport` (customers upsert on
 * `phone_e164`, lead_touches insert `ON CONFLICT DO NOTHING`), so uploading a
 * number that's already on file for a channel is a harmless no-op here too.
 */

'use client';

import { useState } from 'react';
import { formatCurrency, formatNumber, formatDate } from '@/lib/format';
import type { ChannelLeadsPreviewResponse } from '@/app/api/import/channel-leads/preview/route';
import type { ChannelLeadsCommitResult, BulkLeadChannel } from '@/lib/import/channel-leads';
import type { SalesPreviewResponse } from '@/app/api/import/sales/preview/route';
import type { SalesCommitResult } from '@/lib/import/sales';

type ZoneStatus = 'idle' | 'previewing' | 'previewed' | 'error';

interface ZoneState<P> {
  file: File | null;
  status: ZoneStatus;
  preview: P | null;
  error: string | null;
}

const IDLE_LEAD: ZoneState<ChannelLeadsPreviewResponse> = {
  file: null,
  status: 'idle',
  preview: null,
  error: null,
};
const IDLE_SALES: ZoneState<SalesPreviewResponse> = {
  file: null,
  status: 'idle',
  preview: null,
  error: null,
};

const LEAD_ZONES: { key: BulkLeadChannel; label: string; hint: string }[] = [
  { key: 'meta', label: 'Meta', hint: 'Instagram / Facebook lead-form export' },
  { key: 'whatsapp', label: 'WhatsApp', hint: 'WhatsApp broadcast or contact list' },
  { key: 'google', label: 'Google Ads', hint: 'Google Ads leads export' },
  { key: 'other', label: 'Others', hint: 'Any other lead source' },
];

type LeadResult = { ok: true; result: ChannelLeadsCommitResult } | { ok: false; error: string };
type SalesResult = { ok: true; result: SalesCommitResult } | { ok: false; error: string };

function DropZone({
  id,
  title,
  hint,
  fileName,
  status,
  error,
  disabled,
  onFile,
  children,
}: {
  id: string;
  title: string;
  hint: string;
  fileName: string | null;
  status: ZoneStatus;
  error: string | null;
  disabled: boolean;
  onFile: (file: File) => void;
  children?: React.ReactNode;
}) {
  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (disabled) return;
        const file = e.dataTransfer.files?.[0];
        if (file) onFile(file);
      }}
      className={`rounded-2xl border border-dashed p-4 transition-colors ${
        dragOver
          ? 'border-accent bg-accent-soft/30'
          : 'border-line bg-inset/40'
      } ${disabled ? 'opacity-50' : ''}`}
    >
      <label
        htmlFor={id}
        className={`flex items-center gap-3 text-sm text-ink ${disabled ? '' : 'cursor-pointer'}`}
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-soft/50 text-accent">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4 fill-none stroke-current stroke-[1.8]">
            <path d="M12 16V4M12 4l-4 4M12 4l4 4" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" strokeLinecap="round" />
          </svg>
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="font-medium text-ink">{title}</span>
          <span className="truncate text-xs text-ink-muted">
            {fileName ?? `Drag & drop, or click — ${hint}`}
          </span>
        </span>
      </label>
      <input
        id={id}
        type="file"
        accept=".xlsx,.xls"
        disabled={disabled}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = '';
        }}
        className="sr-only"
      />

      {status === 'previewing' && <p className="mt-2 text-xs text-ink-muted">Reading…</p>}
      {error && <p className="mt-2 text-xs text-status-critical">{error}</p>}
      {children}
    </div>
  );
}

export function BulkLeadsImportForm() {
  const [leadZones, setLeadZones] = useState<Record<BulkLeadChannel, ZoneState<ChannelLeadsPreviewResponse>>>({
    meta: IDLE_LEAD,
    whatsapp: IDLE_LEAD,
    google: IDLE_LEAD,
    other: IDLE_LEAD,
  });
  const [salesZone, setSalesZone] = useState<ZoneState<SalesPreviewResponse>>(IDLE_SALES);

  const [submitting, setSubmitting] = useState(false);
  const [leadResults, setLeadResults] = useState<Partial<Record<BulkLeadChannel, LeadResult>>>({});
  const [salesResult, setSalesResult] = useState<SalesResult | null>(null);

  async function previewLead(channel: BulkLeadChannel, file: File) {
    setLeadZones((prev) => ({
      ...prev,
      [channel]: { file, status: 'previewing', preview: null, error: null },
    }));
    try {
      const body = new FormData();
      body.append('file', file);
      body.append('channel', channel);
      const res = await fetch('/api/import/channel-leads/preview', { method: 'POST', body });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Preview failed.');
      setLeadZones((prev) => ({
        ...prev,
        [channel]: { file, status: 'previewed', preview: json, error: null },
      }));
    } catch (err) {
      setLeadZones((prev) => ({
        ...prev,
        [channel]: {
          file,
          status: 'error',
          preview: null,
          error: err instanceof Error ? err.message : 'Preview failed.',
        },
      }));
    }
  }

  async function previewSales(file: File) {
    setSalesZone({ file, status: 'previewing', preview: null, error: null });
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch('/api/import/sales/preview', { method: 'POST', body });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Preview failed.');
      setSalesZone({ file, status: 'previewed', preview: json, error: null });
    } catch (err) {
      setSalesZone({
        file,
        status: 'error',
        preview: null,
        error: err instanceof Error ? err.message : 'Preview failed.',
      });
    }
  }

  const readyChannels = LEAD_ZONES.filter((z) => leadZones[z.key].status === 'previewed');
  const salesReady = salesZone.status === 'previewed';
  const canSubmit = !submitting && (readyChannels.length > 0 || salesReady);

  async function handleSubmit() {
    setSubmitting(true);
    setLeadResults({});
    setSalesResult(null);

    for (const zone of LEAD_ZONES) {
      const z = leadZones[zone.key];
      if (!z.file || z.status !== 'previewed') continue;
      try {
        const body = new FormData();
        body.append('file', z.file);
        body.append('channel', zone.key);
        const res = await fetch('/api/import/channel-leads/commit', { method: 'POST', body });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? 'Import failed.');
        setLeadResults((prev) => ({ ...prev, [zone.key]: { ok: true, result: json } }));
      } catch (err) {
        setLeadResults((prev) => ({
          ...prev,
          [zone.key]: { ok: false, error: err instanceof Error ? err.message : 'Import failed.' },
        }));
      }
    }

    if (salesZone.file && salesZone.status === 'previewed') {
      try {
        const body = new FormData();
        body.append('file', salesZone.file);
        const res = await fetch('/api/import/sales/commit', { method: 'POST', body });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? 'Import failed.');
        setSalesResult({ ok: true, result: json });
      } catch (err) {
        setSalesResult({ ok: false, error: err instanceof Error ? err.message : 'Import failed.' });
      }
    }

    setSubmitting(false);
  }

  const hasResults = Object.keys(leadResults).length > 0 || salesResult !== null;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {LEAD_ZONES.map((zone) => {
          const z = leadZones[zone.key];
          const r = leadResults[zone.key];
          return (
            <DropZone
              key={zone.key}
              id={`bulk-${zone.key}`}
              title={zone.label}
              hint={zone.hint}
              fileName={z.file?.name ?? null}
              status={z.status}
              error={z.error}
              disabled={submitting}
              onFile={(file) => previewLead(zone.key, file)}
            >
              {z.preview && z.status === 'previewed' && (
                <p className="tnum mt-2 text-xs text-ink-2">
                  {formatNumber(z.preview.rawRows)} rows ·{' '}
                  <span className="font-medium text-ink">{formatNumber(z.preview.newCustomers)} new</span> ·{' '}
                  {formatNumber(z.preview.existingCustomers)} known
                  {z.preview.rejected > 0 && <> · {formatNumber(z.preview.rejected)} rejected</>}
                  {z.preview.alreadyImported && (
                    <span className="ml-1 text-ink-muted">(already committed once)</span>
                  )}
                </p>
              )}
              {r && (
                <p
                  className={`tnum mt-2 text-xs font-medium ${
                    r.ok ? 'text-status-good' : 'text-status-critical'
                  }`}
                >
                  {r.ok
                    ? `Committed — ${formatNumber(r.result.touchesInserted)} new leads, ${formatNumber(
                        r.result.touchesSkipped,
                      )} already had this lead`
                    : r.error}
                </p>
              )}
            </DropZone>
          );
        })}
      </div>

      <DropZone
        id="bulk-sales"
        title="Sales report"
        hint="POS export for one billing period"
        fileName={salesZone.file?.name ?? null}
        status={salesZone.status}
        error={salesZone.error}
        disabled={submitting}
        onFile={previewSales}
      >
        {salesZone.preview && salesZone.status === 'previewed' && (
          <p className="tnum mt-2 text-xs text-ink-2">
            {salesZone.preview.dateRange
              ? `${formatDate(salesZone.preview.dateRange.from)} – ${formatDate(salesZone.preview.dateRange.to)} · `
              : ''}
            {formatNumber(salesZone.preview.billsTotal)} bills · {formatCurrency(salesZone.preview.grossRevenue)}
            {salesZone.preview.alreadyImported && (
              <span className="ml-1 text-ink-muted">(already committed once)</span>
            )}
          </p>
        )}
        {salesResult && (
          <p
            className={`tnum mt-2 text-xs font-medium ${
              salesResult.ok ? 'text-status-good' : 'text-status-critical'
            }`}
          >
            {salesResult.ok
              ? `Committed — ${formatNumber(salesResult.result.salesInserted)} bills inserted, ${formatNumber(
                  salesResult.result.salesSkipped,
                )} skipped (dupes)`
              : salesResult.error}
          </p>
        )}
      </DropZone>

      <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-inset/40 p-4">
        <p className="max-w-[52ch] text-sm text-ink-2">
          Drop whichever sheets you have — you don&rsquo;t need all five. Submit adds new leads under
          each channel&rsquo;s campaign and appends the sales report; a phone number already on file is
          skipped automatically, never duplicated.
        </p>
        <button
          type="button"
          disabled={!canSubmit}
          onClick={handleSubmit}
          className="shrink-0 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-40 enabled:active:scale-95"
        >
          {submitting ? 'Submitting…' : 'Submit'}
        </button>
      </div>

      {hasResults && !submitting && (
        <div className="rounded-xl border border-status-good/30 bg-status-good/10 p-4">
          <p className="text-sm font-medium text-ink">Done.</p>
          <p className="mt-2 text-sm text-ink-2">
            Refresh the dashboard, or go to{' '}
            <a href="/analysis" className="text-accent hover:underline">
              Analysis
            </a>{' '}
            to see the sales and lead numbers together.
          </p>
        </div>
      )}
    </div>
  );
}
