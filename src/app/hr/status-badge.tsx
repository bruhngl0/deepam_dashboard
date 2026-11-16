const TONE: Record<string, string> = {
  Active: 'border-emerald-600/30 bg-emerald-600/10 text-emerald-700 dark:text-emerald-300',
  'On leave': 'border-amber-600/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  Resigned: 'border-line bg-inset text-ink-2',
  Exited: 'border-line bg-inset text-ink-muted',
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${TONE[status] ?? TONE.Resigned}`}>{status}</span>;
}
