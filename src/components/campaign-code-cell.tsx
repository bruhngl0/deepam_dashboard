'use client';

import { useState } from 'react';
import { CAMPAIGN_CODE_PATTERN } from '@/lib/campaign-code';

/** Shows a campaign's pre-given ID, or a small field to enter it when missing. */
export function CampaignCodeCell({ campaignId, code }: { campaignId: number; code: string | null }) {
  const [saved, setSaved] = useState(code);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (saved) return <span className="tnum text-ink-2">{saved}</span>;

  async function save() {
    const next = value.trim();
    if (!CAMPAIGN_CODE_PATTERN.test(next)) {
      setError('Letters, digits, - _ / only');
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch('/api/campaigns/code', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ campaignId, campaignCode: next }),
    });
    const data = (await res.json().catch(() => ({}))) as { campaignCode?: string; error?: string };
    setBusy(false);
    if (res.ok && data.campaignCode) setSaved(data.campaignCode);
    else setError(data.error ?? 'Could not save');
  }

  return (
    <form
      className="flex items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <input
        aria-label="Campaign ID"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Enter ID"
        maxLength={40}
        className="w-24 rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink"
      />
      <button type="submit" disabled={busy || !value.trim()} className="rounded-md px-2 py-1 text-xs font-medium text-accent disabled:opacity-50">
        Save
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </form>
  );
}
