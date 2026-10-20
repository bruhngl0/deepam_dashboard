import type { Lead } from './local';

/** Restricts claims by `claimGroup`: `only` these groups, or `exclude` them, optionally claiming `first` groups ahead of the rest. */
export type ClaimRouting = { only: string[] } | { exclude: string[]; first?: string[] };

/**
 * Temporary campaign routing: leads from a matching sheet tab are tagged with
 * the route's group and go only to its salesperson until the route's end date.
 */
export type SheetRoute = {
  group: string;
  /** Shown on the lead card. */
  label: string;
  /** Matched against the tab name, ignoring case and punctuation. */
  tab: string;
  salesperson: string;
  /** The salesperson claims only this route's leads; otherwise they come first, ahead of the general pool. */
  exclusive: boolean;
  /** Env var that overrides `until`. */
  untilEnv: string;
  /** Inclusive IST date (YYYY-MM-DD) through which the route stays active. */
  until: string;
};

/** Virtual calls leads are shown whatever their date (see LEADS_FROM in ./store). */
export const VIRTUAL_CALLS_GROUP = 'virtual-calls';

/** Leads from the Chennai campaign tabs, routed to Margaret Prema. */
export const CHENNAI_GROUP = 'chennai';

/** Tag on leads that registered a visit on the public exhibition form at `/exhb`; shown whatever their date, like Virtual calls. */
export const EXHB_TAG = 'exhb';

/** Tag on AdOnMo leads (the Shubh Convention Centre exhibition list); they go first on the assigned salesperson's desk. */
export const ADONMO_TAG = 'adonmo';

/** How a lead tag is written on its label; other tags are shown in capitals. */
export const TAG_LABELS: Record<string, string> = { [ADONMO_TAG]: 'AdOnMo' };

export const SHEET_ROUTES: SheetRoute[] = [
  { group: 'shubh-convention', label: 'Shubh Convention', tab: 'shubh convention', salesperson: 'Abhishek Thapa', exclusive: false, untilEnv: 'SHUBH_CONVENTION_ROUTING_UNTIL', until: '2026-10-18' },
  { group: 'blvd-club', label: 'BLVD Club', tab: 'blvd club', salesperson: 'Roopa S', exclusive: true, untilEnv: 'BLVD_CLUB_ROUTING_UNTIL', until: '2026-10-18' },
  // Standing route, not a campaign window: every "Virtual calls" tab goes to Sandhya and nobody else.
  { group: VIRTUAL_CALLS_GROUP, label: 'Virtual calls', tab: 'virtual calls', salesperson: 'Sandhya', exclusive: true, untilEnv: 'VIRTUAL_CALLS_ROUTING_UNTIL', until: '2099-12-31' },
  // Standing route: every Chennai tab ("The Residency (Chennai) Lead- Oct") goes to Margaret Prema, first on her
  // desk; not exclusive, so she keeps the general pool too. (Was the shared Chennai desk until 17 Oct 2026.)
  { group: CHENNAI_GROUP, label: 'Chennai', tab: 'chennai', salesperson: 'Margaret Prema', exclusive: false, untilEnv: 'CHENNAI_ROUTING_UNTIL', until: '2099-12-31' },
];

const normalizedTab = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function routeForTab(tab: string, routes = SHEET_ROUTES): SheetRoute | undefined {
  const name = normalizedTab(tab);
  return routes.find((route) => name.includes(route.tab));
}

export function routeLabel(group: string | undefined, routes = SHEET_ROUTES): string | undefined {
  return group ? routes.find((route) => route.group === group)?.label : undefined;
}

const todayIst = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Kolkata' });

export function routeActive(route: SheetRoute, today = todayIst()): boolean {
  const until = process.env[route.untilEnv]?.trim() || route.until;
  return /^\d{4}-\d{2}-\d{2}$/.test(until) && today <= until;
}

export function routeSheetLead(lead: Lead, tab: string, route: SheetRoute, claimedAt: string, active: boolean): Lead {
  const sheetTabs = [...new Set([...(lead.sheetTabs ?? []), tab])];
  return {
    ...lead,
    sheetTabs,
    claimGroup: route.group,
    // A lead moved to someone by hand stays with them; the route only assigns the others.
    ...(active && !(lead.claimPinned && lead.claimedBy) ? {
      claimedBy: route.salesperson,
      claimedAt: lead.claimedBy === route.salesperson && lead.claimedAt ? lead.claimedAt : claimedAt,
    } : {}),
  };
}

/**
 * Claim-group filter for one salesperson. An exclusive route's owner claims
 * only its leads; a non-exclusive owner claims the general pool with their own
 * leads first. Nobody claims another salesperson's active route.
 */
export function claimRoutingFor(salesperson: string, today = todayIst(), routes = SHEET_ROUTES): ClaimRouting {
  const active = routes.filter((route) => routeActive(route, today));
  const own = active.filter((route) => route.salesperson === salesperson);
  if (own.some((route) => route.exclusive)) return { only: own.map((route) => route.group) };
  return {
    exclude: active.filter((route) => route.salesperson !== salesperson).map((route) => route.group),
    first: own.map((route) => route.group),
  };
}
