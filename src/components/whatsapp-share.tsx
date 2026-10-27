'use client';

import { useState } from 'react';

/**
 * Copies `text` and opens WhatsApp with it filled in. With `to` (a number, digits only, with country
 * code) the chat opens straight to that number; otherwise WhatsApp asks which chat or group to send
 * to. A WhatsApp link cannot name a group, so for a group pick it there (the text is also copied, to
 * paste if the app opens without it).
 */
export function WhatsAppShare({ text, to, label = 'Share on WhatsApp' }: { text: string; to?: string | null; label?: string }) {
  const [copied, setCopied] = useState(false);
  const share = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard can be blocked (http, permissions); WhatsApp still gets the text through the link.
    }
    window.open(`https://wa.me/${to ?? ''}?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
  };
  return (
    <button type="button" onClick={share} className="rounded-lg border border-line px-3 py-2 font-medium text-ink hover:bg-inset" aria-live="polite">
      {copied ? 'Copied · opening WhatsApp' : label}
    </button>
  );
}
