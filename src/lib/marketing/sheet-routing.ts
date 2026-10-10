import type { Lead } from './local';

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
  /** Env var that overrides `until`. */
  untilEnv: string;
  /** Inclusive IST date (YYYY-MM-DD) through which the route stays active. */
  until: string;
};

export const SHEET_ROUTES: SheetRoute[] = [
  { group: 'shubh-convention', label: 'Shubh Convention', tab: 'shubh convention', salesperson: 'Abhishek Thapa', untilEnv: 'SHUBH_CONVENTION_ROUTING_UNTIL', until: '2026-10-15' },
  { group: 'blvd-club', label: 'BLVD Club', tab: 'blvd club', salesperson: 'Roopa S', untilEnv: 'BLVD_CLUB_ROUTING_UNTIL', until: '2026-10-15' },
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
 * Claim-group filter for one salesperson: the general pool plus their own
 * active groups, never another salesperson's active group. Campaign leads are
 * normally already assigned at sync, so a route owner still needs the pool.
 */
export function claimRoutingFor(salesperson: string, today = todayIst(), routes = SHEET_ROUTES): { exclude: string[] } {
  return {
    exclude: routes
      .filter((route) => route.salesperson !== salesperson && routeActive(route, today))
      .map((route) => route.group),
  };
}
