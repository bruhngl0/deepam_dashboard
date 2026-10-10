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

export const SHEET_ROUTES: SheetRoute[] = [
  { group: 'shubh-convention', label: 'Shubh Convention', tab: 'shubh convention', salesperson: 'Abhishek Thapa', exclusive: false, untilEnv: 'SHUBH_CONVENTION_ROUTING_UNTIL', until: '2026-10-15' },
  { group: 'blvd-club', label: 'BLVD Club', tab: 'blvd club', salesperson: 'Roopa S', exclusive: true, untilEnv: 'BLVD_CLUB_ROUTING_UNTIL', until: '2026-10-15' },
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
    ...(active ? {
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
