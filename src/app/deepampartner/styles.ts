// The public Ananta Partners pages use the Hemparshwa OS look (components/ui.tsx: cards, controls, the blue primary
// button), so a partner's forms match the staff screens (owner, 28 Nov 2026). No brand colour: the network covers
// Deepam and Kalaniketan.
import { card, control, eyebrow, primaryButton } from '@/components/ui';

export const heading = 'text-2xl font-semibold tracking-tight text-ink md:text-3xl';
export const label = 'mb-1.5 block text-sm font-medium text-ink';
export const input = `${control} block w-full`;
export const select = input;
export const btn = `${primaryButton} min-w-32 px-5`;
export const page = 'mx-auto w-full max-w-[92rem] px-4 pb-14 pt-8 sm:px-6 lg:px-8';
export const errorText = 'text-sm text-status-critical';

/** A card around a form or a block of content. */
export const frame = `${card} p-5 sm:p-8`;
/** Small uppercase label. */
export const kicker = eyebrow;
/** A quiet tile inside a card. */
export const tile = 'rounded-xl border border-line bg-inset/60';
