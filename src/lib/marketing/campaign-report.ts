/**
 * One campaign's KPIs: its leads, the CRM bills they led to, its event (an
 * exhibition venue and dates, when it has one), what it cost and the gross
 * profit on its sales.
 *
 * - Leads: every lead carrying the campaign, any date. A lead converts with a
 *   CRM bill on its phone dated on or after the lead date (the rule used across
 *   Marketing Intelligence).
 * - Event: bills at the venue or the Exhibition till between the event dates,
 *   and Walktrack visits at the venue on those dates.
 * - Footfall: those venue visits plus Walktrack visits by the campaign's leads
 *   on or after their lead date, at any store.
 * - Total bills and sales: lead bills and event bills, each bill once.
 * - A buyer is new when their first bill (CRM, or the loyalty records that go
 *   back further) is on or after the day the
 *   campaign reached them (lead date, or the event's first day).
 * - Gross profit: sales less the purchase value of the items sold, over the
 *   bills whose items carry a purchase value.
 */

export type CampaignSettings = {
  /** Walktrack store of the event venue; null when the campaign has no event. */
  venueStoreId: number | null;
  /** Event dates, YYYY-MM-DD; both or neither. */
  from: string;
  to: string;
  exhibitionExpense: number;
};

export const NO_SETTINGS: CampaignSettings = { venueStoreId: null, from: '', to: '', exhibitionExpense: 0 };

export type ReportBill = {
  id: string;
  amount: number;
  date: string;
  customerId: string | null;
  /** The customer's first CRM bill of any amount above zero, YYYY-MM-DD. */
  firstBill: string | null;
  fromLead: boolean;
  atEvent: boolean;
  /** The day the campaign reached this customer: the lead date or the event's first day. */
  since: string;
  /** Purchase value of the bill's items; null when none is recorded. */
  cost: number | null;
};

export type ReportVisit = { id: string; people: number; converted: boolean };

export type CampaignInputs = {
  leads: number;
  convertedLeads: number;
  bills: ReportBill[];
  visits: ReportVisit[];
  /** Campaign Summary spend; null when the sheets have no row for this campaign. */
  spend: number | null;
  settings: CampaignSettings;
};

export type CampaignKpis = {
  leads: number;
  convertedLeads: number;
  leadConversion: number | null;
  leadSales: number;
  leadBills: number;
  footfall: number;
  footfallPeople: number;
  footfallConverted: number;
  footfallConversion: number | null;
  bills: number;
  sales: number;
  averageBill: number | null;
  customers: number;
  newCustomers: number;
  existingCustomers: number;
  newCustomerShare: number | null;
  /** Bills with no customer on them, left out of the customer counts. */
  billsWithoutCustomer: number;
  marketingSpend: number;
  spendFound: boolean;
  exhibitionExpense: number;
  investment: number;
  costPerLead: number | null;
  acquisitionCost: number | null;
  grossProfit: number | null;
  grossProfitShare: number | null;
  /** Bills left out of gross profit because their items carry no purchase value. */
  billsWithoutCost: number;
};

const ratio = (a: number, b: number) => (b ? a / b : null);
const round = (n: number) => Math.round(n * 100) / 100;

export function campaignKpis(input: CampaignInputs): CampaignKpis {
  const bills = [...new Map(input.bills.map((bill) => [bill.id, bill])).values()];
  const leadBills = bills.filter((bill) => bill.fromLead);
  const sales = bills.reduce((sum, bill) => sum + bill.amount, 0);
  const leadSales = leadBills.reduce((sum, bill) => sum + bill.amount, 0);

  // A customer reached by both a lead and the event counts from the earlier of the two.
  const buyers = new Map<string, { since: string; firstBill: string | null }>();
  for (const bill of bills) {
    if (!bill.customerId) continue;
    const seen = buyers.get(bill.customerId);
    if (!seen || bill.since < seen.since) buyers.set(bill.customerId, { since: bill.since, firstBill: bill.firstBill });
  }
  const newCustomers = [...buyers.values()].filter((buyer) => !buyer.firstBill || buyer.firstBill >= buyer.since).length;

  const costed = bills.filter((bill) => bill.cost !== null);
  const costedSales = costed.reduce((sum, bill) => sum + bill.amount, 0);
  const grossProfit = costed.length ? costed.reduce((sum, bill) => sum + bill.amount - (bill.cost ?? 0), 0) : null;

  const spend = input.spend ?? 0;
  const expense = input.settings.exhibitionExpense;
  const investment = spend + expense;
  const footfallConverted = input.visits.filter((visit) => visit.converted).length;

  return {
    leads: input.leads,
    convertedLeads: input.convertedLeads,
    leadConversion: ratio(input.convertedLeads * 100, input.leads),
    leadSales: round(leadSales),
    leadBills: leadBills.length,
    footfall: input.visits.length,
    footfallPeople: input.visits.reduce((sum, visit) => sum + visit.people, 0),
    footfallConverted,
    footfallConversion: ratio(footfallConverted * 100, input.visits.length),
    bills: bills.length,
    sales: round(sales),
    averageBill: ratio(sales, bills.length),
    customers: buyers.size,
    newCustomers,
    existingCustomers: buyers.size - newCustomers,
    newCustomerShare: ratio(newCustomers * 100, buyers.size),
    billsWithoutCustomer: bills.filter((bill) => !bill.customerId).length,
    marketingSpend: round(spend),
    spendFound: input.spend !== null,
    exhibitionExpense: round(expense),
    investment: round(investment),
    costPerLead: input.spend === null ? null : ratio(spend, input.leads),
    acquisitionCost: investment ? ratio(investment, newCustomers) : null,
    grossProfit: grossProfit === null ? null : round(grossProfit),
    grossProfitShare: grossProfit === null ? null : ratio(grossProfit * 100, costedSales),
    billsWithoutCost: bills.length - costed.length,
  };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Settings from a request body or the saved setting, or an error message. */
export function parseSettings(value: unknown): CampaignSettings | string {
  if (!value || typeof value !== 'object') return 'Send the campaign settings.';
  const raw = value as Record<string, unknown>;
  const venue = raw.venueStoreId === null || raw.venueStoreId === '' || raw.venueStoreId === undefined ? null : Number(raw.venueStoreId);
  if (venue !== null && !Number.isInteger(venue)) return 'Choose a venue from the list.';
  const from = String(raw.from ?? '').trim(), to = String(raw.to ?? '').trim();
  if ((from && !DAY.test(from)) || (to && !DAY.test(to))) return 'Event dates must be full dates.';
  if (!from !== !to) return 'Enter both event dates, or neither.';
  if (from && from > to) return 'The event cannot end before it starts.';
  if (venue !== null && !from) return 'Enter the event dates for the venue.';
  const expense = raw.exhibitionExpense === '' || raw.exhibitionExpense === undefined || raw.exhibitionExpense === null ? 0 : Number(raw.exhibitionExpense);
  if (!Number.isFinite(expense) || expense < 0) return 'Exhibition expense must be zero or more.';
  return { venueStoreId: venue, from, to, exhibitionExpense: round(expense) };
}

/** The venue a campaign name points at: a store whose distinctive word ("Shubh", "BLVD", "Residency") is in the name. */
export function suggestVenue(campaign: string, venues: { id: number; name: string }[]): { id: number; name: string } | null {
  const name = campaign.toLowerCase();
  return venues.find((venue) => {
    const word = venue.name.toLowerCase().split(/[^a-z0-9]+/).find((w) => w.length > 3 && w !== 'the' && w !== 'collection' && w !== 'convention');
    return !!word && name.includes(word);
  }) ?? null;
}

/** Whether two event date ranges share a day. */
export const overlaps = (a: CampaignSettings, b: CampaignSettings) => !!a.from && !!b.from && a.from <= b.to && b.from <= a.to;
