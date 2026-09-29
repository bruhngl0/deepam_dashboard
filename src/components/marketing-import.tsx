'use client';
import { useMemo, useState } from 'react';
import { commitPreview, guessMapping, previewRows, SOURCES, type Dataset, type Kind, type Mapping } from '@/lib/marketing/local';
import { button, input, money } from './marketing-shared';
type Upload = { kind: Kind; filename: string; sheets: { name: string; rows: Record<string, unknown>[]; headers: string[] }[]; sheet: number; mapping: Mapping };
export function MarketingImport({ data, save }: { data: Dataset; save: (data: Dataset) => boolean }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [upload, setUpload] = useState<Upload | null>(null);
  async function openFile(file: File, kind: Kind) {
    setMessage(''); setUpload(null); setBusy(true);
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('Please use a file smaller than 10 MB.');
      const XLSX = await import('xlsx');
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      const sheets = workbook.SheetNames.map(name => {
        const grid = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, defval: '', blankrows: true });
        const headers = (grid[0] ?? []).map(v => String(v).trim());
        if (new Set(headers.filter(Boolean)).size !== headers.filter(Boolean).length) throw new Error(`Duplicate column names in ${name}. Give each column a unique header.`);
        const rows = grid.slice(1).map(row => Object.fromEntries(headers.map((h, i) => [h, row[i] ?? ''])));
        return { name, headers: headers.filter(Boolean), rows };
      }).filter(s => s.headers.length);
      if (!sheets.length) throw new Error('No columns found. Put column headings in the first row.');
      setUpload({ kind, filename: file.name, sheets, sheet: 0, mapping: guessMapping(sheets[0].headers) });
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not read this spreadsheet.'); }
    finally { setBusy(false); }
  }

  const preview = useMemo(() => upload ? previewRows(upload.sheets[upload.sheet].rows, upload.kind, upload.mapping, data) : null, [upload, data]);
  const required: (keyof Mapping)[] = upload?.kind === 'leads' ? ['phone', 'name', 'source'] : ['phone', 'invoice'];
  const fields: (keyof Mapping)[] = upload?.kind === 'leads' ? ['phone', 'name', 'email', 'city', 'source', 'campaignId', 'preferredStore', 'date', 'cost'] : ['phone', 'invoice', 'amount', 'date', 'preferredStore'];
  const labels: Record<keyof Mapping, string> = { phone: 'Contact number', name: 'Name', email: 'Email', city: 'City', source: 'Sources', campaignId: 'Campaign ID', preferredStore: 'Store', date: 'Date and time (IST)', cost: 'Cost per lead', invoice: 'Invoice ID', amount: 'Sales amount' };
  const selected = upload ? fields.map(f => upload.mapping[f]).filter(Boolean) : [];
  const mappingReady = upload && required.every(k => upload.mapping[k]) && new Set(selected).size === selected.length;
  const accepted = preview ? preview.leads.length + preview.sales.length : 0;
  async function downloadTemplate(kind: Kind) {
    const XLSX = await import('xlsx');
    const workbook = XLSX.utils.book_new();
    const rows = kind === 'leads' ? [{ Name: 'Example lead', Number: '9000123410', Email: 'lead@example.com', City: 'Bengaluru', Source: 'Meta ads; WhatsApp', 'Campaign ID': 'CAM-2026-001', 'Preferred Store': 'MG', 'Date and time': '2026-09-28 10:30', 'Cost per lead': 120 }] : [{ Number: '9000123410', Invoice: 'EXAMPLE-001', Amount: 2500, 'Date and time': '2026-09-28 15:30', Store: 'MG' }];
    const sheet = XLSX.utils.json_to_sheet(rows);
    sheet['!cols'] = Object.keys(rows[0]).map(() => ({ wch: 24 }));
    XLSX.utils.book_append_sheet(workbook, sheet, kind);
    XLSX.writeFile(workbook, `marketing-${kind}-template.xlsx`);
  }

 return <div className="space-y-5">
      <p className="text-sm text-ink-2">Sources: {SOURCES.join(', ')}. Separate multiple sources with a semicolon. Dates without a time retain an unknown time; blank acquisition dates use import time (IST). Unavailable contact fields stay blank for later completion.</p>
      <div className="grid gap-4 md:grid-cols-2">
        {(['leads', 'sales'] as const).map((kind, i) => <section key={kind} className="card rounded-2xl border border-line bg-surface p-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-accent">Step {i + 1}</p><h2 className="mt-2 text-lg font-semibold text-ink">Import {kind}</h2>
          <p className="mt-2 text-sm text-ink-2">{kind === 'leads' ? 'Name, phone, email, sources, campaign, date/time, preferred store, city and optional cost per lead. Lead IDs are generated automatically.' : 'Mobile number and a unique invoice / bill ID. Include amount, purchase date/time and store. One row per bill; matching profiles update automatically.'}</p>
          <div className="mt-4 flex flex-wrap items-center gap-3"><label className={`${button} cursor-pointer`}>Choose {kind} file<input aria-label={`Import ${kind} file`} type="file" accept=".xlsx,.xls,.csv" disabled={busy} className="sr-only" onChange={e => { const f = e.target.files?.[0]; if (f) void openFile(f, kind); e.target.value = ''; }} /></label><button className="text-sm text-accent underline" onClick={() => void downloadTemplate(kind).catch(() => setMessage('Could not download template. Please retry.'))}>Download template</button></div>
          <p className="mt-3 text-xs text-ink-muted">Excel or CSV · up to 10 MB · headers in row 1</p>
        </section>)}
      </div>
      {busy && <p role="status" className="text-sm text-ink-2">Reading spreadsheet…</p>}
      {message && <p role="status" className="rounded-xl border border-line bg-inset p-4 text-sm text-ink">{message}</p>}
      {upload && preview && <section className="rounded-2xl border border-line bg-surface p-5">
        <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-semibold text-ink">Review {upload.kind} import · {upload.filename}</h2><button className={button} onClick={() => setUpload(null)}>Cancel</button></div>
        <label className="mt-4 block text-sm text-ink-2">Worksheet <select className={`${input} ml-2`} value={upload.sheet} onChange={e => { const sheet = Number(e.target.value); setUpload({ ...upload, sheet, mapping: guessMapping(upload.sheets[sheet].headers) }); }}>{upload.sheets.map((s, i) => <option key={s.name} value={i}>{s.name}</option>)}</select></label>
        <div className="mt-4 flex flex-wrap gap-4">{fields.map(field => <label key={field} className="flex flex-col gap-1 text-sm capitalize text-ink-2">{labels[field]}{required.includes(field) ? ' *' : ' (optional)'}<select className={input} value={upload.mapping[field]} onChange={e => setUpload({ ...upload, mapping: { ...upload.mapping, [field]: e.target.value } })}><option value="">Select column</option>{upload.sheets[upload.sheet].headers.map(h => <option key={h}>{h}</option>)}</select></label>)}</div>
        <p className="mt-4 text-sm text-ink-2">Indian mobile numbers are normalized to +91. One phone keeps one lead ID. Additional sources and campaigns merge into its acquisition history. Repeated invoices are skipped; conflicting bills are rejected. Unmatched sales are kept for future lead imports.</p>
        {mappingReady ? <><p className="mt-4 font-medium text-ink">{accepted - preview.updated} new records · {preview.updated} existing leads updated · {preview.duplicates} duplicates skipped · {preview.errors.length} invalid rows</p>
          <div className="mt-3 overflow-auto"><table className="w-full text-left text-sm text-ink"><thead><tr><th className="p-2">Phone</th><th className="p-2">{upload.kind === 'leads' ? 'Name' : 'Invoice'}</th><th className="p-2">{upload.kind === 'leads' ? 'Source' : 'Amount'}</th>{upload.kind === 'leads' && <><th className="p-2">Email</th><th className="p-2">City</th><th className="p-2">Cost</th><th className="p-2">Campaign ID</th><th className="p-2">Preferred store</th><th className="p-2">Date</th></>}</tr></thead><tbody>{preview.leads.slice(0, 5).map(l => <tr key={l.phone}><td className="p-2">{l.phone}</td><td className="p-2">{l.name}</td><td className="p-2">{l.acquisitions.map(a => a.source).join(', ')}</td><td className="p-2">{l.email || '—'}</td><td className="p-2">{l.city || '—'}</td><td className="p-2">{l.acquisitions.some(a => a.cost !== null) ? money(l.acquisitions.reduce((n, a) => n + (a.cost ?? 0), 0)) : '—'}</td><td className="p-2">{l.campaignId || '—'}</td><td className="p-2">{l.preferredStore || '—'}</td><td className="p-2">{l.acquiredAt.replace('T', ' ') || '—'}</td></tr>)}{preview.sales.slice(0, 5).map(s => <tr key={s.invoice}><td className="p-2">{s.phone}</td><td className="p-2">{s.invoice}</td><td className="p-2">{s.amount === null ? 'Not supplied' : money(s.amount)}</td></tr>)}</tbody></table></div><p className="text-xs text-ink-muted">Preview shows the first 5 accepted rows.</p>
          {!!preview.errors.length && <details className="mt-3 text-sm text-ink-2"><summary>Review invalid rows ({preview.errors.length})</summary><ul className="mt-2 max-h-48 overflow-auto">{preview.errors.map(e => <li key={e.row}>Row {e.row}: {e.reason}</li>)}</ul></details>}
          <button disabled={!accepted} className={`${button} mt-4`} onClick={() => { if (save(commitPreview(data, preview))) { setMessage(`Imported ${accepted} ${upload.kind}. Skipped ${preview.duplicates} duplicates and ${preview.errors.length} invalid rows. Conversion matching is up to date.`); setUpload(null); } }}>Import {accepted} records</button></> : <p className="mt-4 text-sm text-ink-2">Select a different column for each required field to preview the import.</p>}
      </section>}

 </div>;
}
