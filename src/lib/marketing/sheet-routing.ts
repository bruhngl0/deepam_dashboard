import type { Lead } from './local';

/**
 * Temporary campaign routing: leads from a matching sheet tab are tagged with
 * the route's group and go only to its salesperson until the route's end date.
 */
export type SheetRoute = {
  group: string;
  /** Matched against the tab name, ignoring case and punctuation. */
  tab: string;
  salesperson: string;
  /** Env var that overrides `until`. */
  untilEnv: string;
  /** Inclusive IST date (YYYY-MM-DD) through which the route stays active. */
  until: string;
};

export const SHEET_ROUTES: SheetRoute[] = [
  { group: 'shubh-convention', tab: 'shubh convention', salesperson: 'Abhishek Thapa', untilEnv: 'SHUBH_CONVENTION_ROUTING_UNTIL', until: '2026-10-15' },
  { group: 'blvd-club', tab: 'blvd club', salesperson: 'Roopa S', untilEnv: 'BLVD_CLUB_ROUTING_UNTIL', until: '2026-10-15' },
];

const normalizedTab = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function routeForTab(tab: string, routes = SHEET_ROUTES): SheetRoute | undefined {
  const name = normalizedTab(tab);
  return routes.find((route) => name.includes(route.tab));
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

/** Claim-group filter for one salesperson: only their active groups, or none of anyone's. */
export function claimRoutingFor(salesperson: string, today = todayIst(), routes = SHEET_ROUTES): { only: string[] } | { exclude: string[] } {
  const active = routes.filter((route) => routeActive(route, today));
  const own = active.filter((route) => route.salesperson === salesperson).map((route) => route.group);
  return own.length ? { only: own } : { exclude: active.map((route) => route.group) };
}
