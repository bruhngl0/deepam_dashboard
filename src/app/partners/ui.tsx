/** Pieces shared by the Partner Network pages: header, panels, badges, avatars, icons and table cells. */

import Link from 'next/link';
import { COMMISSION_STATUS_LABEL, PARTNER_STATUS_LABEL, REFERRAL_STATUS_LABEL, type CommissionStatus, type PartnerStatus, type ReferralStatus } from '@/lib/partners/constants';
import { FilterSlot } from '@/components/filter-box';

/* ---------- Icons (inline, stroke-based, 24px grid) ---------- */

const paths = {
  handshake: <><path d="m11 17 2 2a1.4 1.4 0 0 0 2-2" /><path d="m14 14 2.5 2.5a1.4 1.4 0 0 0 2-2l-3.9-3.9a2.1 2.1 0 0 0-3 0l-.9.9a1.4 1.4 0 0 1-2-2l2.8-2.8a3.9 3.9 0 0 1 5 0l.5.4a1.9 1.9 0 0 0 1.6.4L21 7" /><path d="m21 3 1 11h-2M3 3 2 14l6.5 6.5a1.4 1.4 0 0 0 2-2M3 4h8" /></>,
  users: <><circle cx="9" cy="8.5" r="3.5" /><path d="M2.5 19.5a6.5 6.5 0 0 1 13 0" /><path d="M16 5.2a3.5 3.5 0 0 1 0 6.6M18 14.2a6.5 6.5 0 0 1 3.5 5.3" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4.5 20a7.5 7.5 0 0 1 15 0" /></>,
  inbox: <><path d="M3.5 13.5 6 5.5h12l2.5 8" /><path d="M3.5 13.5V18a1.5 1.5 0 0 0 1.5 1.5h14a1.5 1.5 0 0 0 1.5-1.5v-4.5H15a3 3 0 0 1-6 0H3.5Z" /></>,
  link: <><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1" /><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1" /></>,
  bag: <><path d="M5 8h14l-1 12H6L5 8Z" /><path d="M9 10V6.5a3 3 0 0 1 6 0V10" /></>,
  receipt: <><path d="M6 3.5h12v17l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3-2 1.3v-17Z" /><path d="M9 8.5h6M9 12h6M9 15.5h3.5" /></>,
  check: <><circle cx="12" cy="12" r="8.5" /><path d="m8.5 12.2 2.4 2.3 4.6-4.8" /></>,
  wallet: <><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3" /><path d="M4 7.5V17a2 2 0 0 0 2 2h13a1 1 0 0 0 1-1v-3" /><path d="M20 10h-4a2 2 0 0 0 0 4h4a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1Z" /></>,
  rupee: <><path d="M7 4.5h10M7 9h10M7 4.5h3.5a4.5 4.5 0 0 1 0 9H7l8 6.5" /></>,
  sliders: <><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  calendar: <><rect x="4" y="5.5" width="16" height="14.5" rx="2" /><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" /></>,
  alert: <><path d="M10.3 4.3 2.9 17.2A2 2 0 0 0 4.6 20h14.8a2 2 0 0 0 1.7-2.8L13.7 4.3a2 2 0 0 0-3.4 0Z" /><path d="M12 9.5v4M12 16.8v.01" /></>,
  file: <><path d="M14 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8L14 3.5Z" /><path d="M14 3.5V8h4.5M9 13h6M9 16.5h4" /></>,
  grid: <><rect x="4" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" /></>,
  trophy: <><path d="M8 4.5h8v5a4 4 0 0 1-8 0v-5Z" /><path d="M8 6.5H5a3 3 0 0 0 3 4M16 6.5h3a3 3 0 0 1-3 4M12 13.5v3M8.5 20h7M10 16.5h4l.5 3.5h-5l.5-3.5Z" /></>,
  share: <><circle cx="18" cy="5.5" r="2.5" /><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="18.5" r="2.5" /><path d="m8.2 10.8 7.6-4M8.2 13.2l7.6 4" /></>,
  download: <><path d="M12 4v11.5M7.5 11 12 15.5 16.5 11" /><path d="M4.5 15v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3" /></>,
  arrow: <><path d="M5 12h14M13.5 6.5 19 12l-5.5 5.5" /></>,
  back: <><path d="M19 12H5M10.5 6.5 5 12l5.5 5.5" /></>,
  left: <><path d="m14.5 6-6 6 6 6" /></>,
  right: <><path d="m9.5 6 6 6-6 6" /></>,
  map: <><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" /><circle cx="12" cy="10" r="2.3" /></>,
  phone: <><path d="M5 4.5h3.2l1.6 4-2 1.3a10 10 0 0 0 6.4 6.4l1.3-2 4 1.6V19a1.5 1.5 0 0 1-1.5 1.5A15.5 15.5 0 0 1 3.5 6 1.5 1.5 0 0 1 5 4.5Z" /></>,
  mail: <><rect x="3.5" y="5.5" width="17" height="13" rx="2" /><path d="m4 7 8 6 8-6" /></>,
  filter: <><path d="M4 5.5h16l-6.2 7.3v5.5l-3.6 1.7v-7.2L4 5.5Z" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, className = 'size-4' }: { name: IconName; className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={`shrink-0 fill-none stroke-current stroke-[1.8] [stroke-linecap:round] [stroke-linejoin:round] ${className}`}>
      {paths[name]}
    </svg>
  );
}

export type Tone = 'accent' | 'good' | 'wait' | 'info' | 'bad' | 'quiet';

const tileTone: Record<Tone, string> = {
  accent: 'bg-accent-soft/50 text-accent',
  good: 'bg-emerald-600/10 text-emerald-700 dark:text-emerald-300',
  wait: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  info: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
  bad: 'bg-red-500/10 text-red-700 dark:text-red-300',
  quiet: 'bg-inset text-ink-2',
};

export function IconTile({ name, tone = 'accent', size = 'md' }: { name: IconName; tone?: Tone; size?: 'sm' | 'md' | 'lg' }) {
  const box = { sm: 'size-8 rounded-lg', md: 'size-10 rounded-xl', lg: 'size-12 rounded-2xl' }[size];
  const icon = { sm: 'size-4', md: 'size-5', lg: 'size-6' }[size];
  return <span className={`inline-flex shrink-0 items-center justify-center ${box} ${tileTone[tone]}`}><Icon name={name} className={icon} /></span>;
}

/* ---------- Avatars ---------- */

const AVATAR = [
  'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  'bg-rose-500/15 text-rose-700 dark:text-rose-300',
  'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  'bg-teal-500/15 text-teal-700 dark:text-teal-300',
  'bg-orange-500/15 text-orange-700 dark:text-orange-300',
];

export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  const initials = ((words[0]?.[0] ?? '?') + (words.length > 1 ? words[words.length - 1][0] : words[0]?.[1] ?? '')).toUpperCase();
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const box = { sm: 'size-7 text-[10px]', md: 'size-9 text-xs', lg: 'size-12 text-sm', xl: 'size-16 text-lg' }[size];
  return <span aria-hidden="true" className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold ${box} ${AVATAR[h % AVATAR.length]}`}>{initials}</span>;
}

/** A name with its avatar and a muted second line. */
export function Who({ name, sub, href, size = 'sm' }: { name: string; sub?: React.ReactNode; href?: string; size?: 'sm' | 'md' }) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <Avatar name={name} size={size} />
      <span className="min-w-0">
        {href ? <Link href={href} className="block truncate font-medium text-ink hover:text-accent hover:underline">{name}</Link> : <span className="block truncate font-medium text-ink">{name}</span>}
        {sub && <span className="tnum block truncate text-xs font-normal text-ink-muted">{sub}</span>}
      </span>
    </span>
  );
}

/* ---------- Badges ---------- */

const GOOD = 'bg-emerald-600/10 text-emerald-700 ring-emerald-600/20 dark:text-emerald-300';
const WAIT = 'bg-amber-500/10 text-amber-700 ring-amber-600/25 dark:text-amber-300';
const INFO = 'bg-sky-500/10 text-sky-700 ring-sky-600/20 dark:text-sky-300';
const BAD = 'bg-red-500/10 text-red-700 ring-red-600/20 dark:text-red-300';
const QUIET = 'bg-inset text-ink-2 ring-line';

const TONE: Record<string, string> = {
  applied: WAIT, approved: GOOD, rejected: QUIET, suspended: BAD,
  registered: INFO, converted: GOOD, expired: QUIET, declined: QUIET,
  pending: WAIT, validated: INFO, paid: GOOD,
};

function Badge({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${tone}`}>
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />{children}
    </span>
  );
}

export const PartnerBadge = ({ status }: { status: PartnerStatus }) => <Badge tone={TONE[status]}>{PARTNER_STATUS_LABEL[status]}</Badge>;
export const ReferralBadge = ({ status }: { status: ReferralStatus }) => <Badge tone={TONE[status]}>{REFERRAL_STATUS_LABEL[status]}</Badge>;
export const CommissionBadge = ({ status }: { status: CommissionStatus }) => <Badge tone={status === 'rejected' ? BAD : TONE[status]}>{COMMISSION_STATUS_LABEL[status]}</Badge>;

/* ---------- Page structure ---------- */

/** The page title row: icon tile, eyebrow, title, description, actions. */
export function PartnerHeader({ icon, eyebrow, title, description, meta, actions }: {
  icon?: IconName; eyebrow?: React.ReactNode; title: React.ReactNode; description?: React.ReactNode; meta?: React.ReactNode; actions?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 items-start gap-4">
        {icon && <span className="hidden sm:inline-flex"><IconTile name={icon} size="lg" /></span>}
        <div className="min-w-0">
          {eyebrow && <p className="text-[11px] font-bold uppercase tracking-[0.09em] text-ink-muted">{eyebrow}</p>}
          <h1 className={`${eyebrow ? 'mt-1 ' : ''}text-2xl font-semibold tracking-tight text-balance text-ink sm:text-[1.75rem]`}>{title}</h1>
          {description && <p className="mt-1 max-w-3xl text-sm text-ink-2">{description}</p>}
          {meta && <div className="tnum mt-1.5 text-xs text-ink-muted">{meta}</div>}
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap items-end justify-end gap-2">
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        <FilterSlot />
      </div>
    </header>
  );
}

/** A card section with an optional icon, count and actions. `flush` rules off the header for an edge-to-edge table. */
export function Panel({ title, description, icon, tone = 'accent', count, actions, flush = false, className = '', children }: {
  title?: React.ReactNode; description?: React.ReactNode; icon?: IconName; tone?: Tone; count?: number; actions?: React.ReactNode; flush?: boolean; className?: string; children: React.ReactNode;
}) {
  const head = title || actions;
  return (
    <section className={`card overflow-hidden rounded-2xl border border-line bg-surface ${className}`}>
      {head && (
        <div className={`flex flex-wrap items-start justify-between gap-3 px-5 pt-5 ${flush ? 'border-b border-grid pb-4' : 'pb-3'}`}>
          <div className="flex min-w-0 items-start gap-3">
            {icon && <IconTile name={icon} tone={tone} size="sm" />}
            <div className="min-w-0">
              {title && (
                <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight text-ink">
                  {title}
                  {count != null && <span className="tnum inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-inset px-1.5 text-xs font-semibold text-ink-2">{count}</span>}
                </h2>
              )}
              {description && <p className="mt-0.5 text-sm text-ink-2">{description}</p>}
            </div>
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={flush ? '' : `px-5 pb-5 ${head ? '' : 'pt-5'}`}>{children}</div>
    </section>
  );
}

/** A "see all" link for a panel header. */
export function PanelLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-medium text-accent transition-colors hover:bg-accent-soft/30">
      {children}<Icon name="arrow" className="size-3.5" />
    </Link>
  );
}

/** One headline number with an icon. */
export function Stat({ label, value, caption, href, icon, tone = 'accent', highlight = false }: {
  label: string; value: React.ReactNode; caption?: React.ReactNode; href?: string; icon?: IconName; tone?: Tone; highlight?: boolean;
}) {
  const body = <>
    <div className="flex items-start justify-between gap-3">
      <p className="text-[11px] font-bold uppercase tracking-[0.09em] text-ink-muted">{label}</p>
      {icon && <IconTile name={icon} tone={tone} size="sm" />}
    </div>
    <p className={`tnum mt-2 text-3xl leading-none font-semibold tracking-tight ${highlight ? 'text-accent' : 'text-ink'}`}>{value}</p>
    {caption && <p className="mt-2 line-clamp-2 text-sm text-ink-2">{caption}</p>}
    {href && <Icon name="arrow" className="absolute right-4 bottom-4 size-4 text-ink-muted opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100" />}
  </>;
  const cls = `card group relative flex flex-col rounded-2xl border bg-surface px-5 py-4 text-left ${highlight ? 'border-accent/40' : 'border-line'}`;
  return href
    ? <Link href={href} className={`${cls} card-interactive transition-all hover:-translate-y-0.5 hover:border-accent/50`}>{body}</Link>
    : <div className={cls}>{body}</div>;
}

/** A thin bar showing a share of the largest value. */
export function Bar({ value, max, tone = 'accent' }: { value: number; max: number; tone?: 'accent' | 'good' }) {
  const pct = max > 0 ? Math.max(value > 0 ? 3 : 0, Math.round((value / max) * 100)) : 0;
  return (
    <span className="block h-1.5 w-full overflow-hidden rounded-full bg-inset" aria-hidden="true">
      <span className={`block h-full rounded-full ${tone === 'good' ? 'bg-emerald-500' : 'bg-accent'}`} style={{ width: `${pct}%` }} />
    </span>
  );
}

export function Empty({ icon = 'inbox', children }: { icon?: IconName; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-10 text-center text-sm text-ink-muted">
      <IconTile name={icon} tone="quiet" />
      <div>{children}</div>
    </div>
  );
}

export function Callout({ tone = 'wait', title, children, className = '' }: { tone?: 'wait' | 'bad' | 'good' | 'info'; title?: React.ReactNode; children?: React.ReactNode; className?: string }) {
  const c = {
    wait: 'border-amber-600/30 bg-amber-500/10 text-amber-900 dark:text-amber-200 [&>svg]:text-amber-600',
    bad: 'border-red-500/40 bg-red-500/10 text-red-800 dark:text-red-200 [&>svg]:text-red-600',
    good: 'border-emerald-600/30 bg-emerald-600/10 text-emerald-900 dark:text-emerald-200 [&>svg]:text-emerald-600',
    info: 'border-sky-600/30 bg-sky-500/10 text-sky-900 dark:text-sky-200 [&>svg]:text-sky-600',
  }[tone];
  return (
    <div role={tone === 'bad' ? 'alert' : 'status'} className={`flex gap-3 rounded-xl border px-4 py-3 text-sm ${c} ${className}`}>
      <Icon name={tone === 'good' ? 'check' : 'alert'} className="mt-0.5 size-4" />
      <div className="min-w-0 flex-1">{title && <p className="font-medium">{title}</p>}{children && <div className={title ? 'mt-0.5 opacity-90' : ''}>{children}</div>}</div>
    </div>
  );
}

/** The ?notice= / ?error= a partner action returns with. */
export function Notices({ sp }: { sp: Record<string, string | string[] | undefined> }) {
  const error = typeof sp.error === 'string' ? sp.error : null;
  const notice = typeof sp.notice === 'string' ? sp.notice : null;
  return <>
    {error && <Callout tone="bad">{error}</Callout>}
    {notice && <Callout tone="good">{notice}</Callout>}
  </>;
}

export const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '');
export const th = 'bg-inset/60 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted first:pl-5 last:pr-5';
export const td = 'px-4 py-3 align-top first:pl-5 last:pr-5';
/** Body rows: a rule above and a hover tint. */
export const tr = 'border-t border-grid transition-colors hover:bg-inset/50';
/** A table's <thead> row (keeps the old eyebrow look off the header cells). */
export const headRow = 'text-left';
