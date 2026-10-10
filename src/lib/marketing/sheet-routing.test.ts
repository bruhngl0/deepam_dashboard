import { describe, expect, it } from 'vitest';
import { makeLead } from './local';
import { claimRoutingFor, routeActive, routeForTab, routeSheetLead } from './sheet-routing';

describe('temporary campaign routing', () => {
  it('matches the live worksheet names without depending on case or punctuation', () => {
    expect(routeForTab('Shubh Convention Lead- Oct')?.salesperson).toBe('Abhishek Thapa');
    expect(routeForTab('SHUBH convention_lead Oct')?.group).toBe('shubh-convention');
    expect(routeForTab('BLVD Club (Blr) Lead- Oct')?.salesperson).toBe('Roopa S');
    expect(routeForTab('Store lead campaign- Oct')).toBeUndefined();
  });

  it('is active through the configured end date and stops the next day', () => {
    const route = routeForTab('Shubh Convention Lead- Oct')!;
    expect(routeActive(route, '2026-10-15')).toBe(true);
    expect(routeActive(route, '2026-10-16')).toBe(false);
  });

  it('tags and assigns campaign leads to the route salesperson while active', () => {
    const lead = makeLead({ phone: '+919000123410', name: 'Asha', source: 'Meta ads' });
    const route = routeForTab('BLVD Club (Blr) Lead- Oct')!;
    const routed = routeSheetLead(lead, 'BLVD Club (Blr) Lead- Oct', route, '2026-10-10T13:00:00', true);
    expect(routed).toMatchObject({
      claimedBy: 'Roopa S',
      claimedAt: '2026-10-10T13:00:00',
      claimGroup: 'blvd-club',
      sheetTabs: ['BLVD Club (Blr) Lead- Oct'],
    });
  });

  it('gives route owners only their groups and keeps everyone else out of active groups', () => {
    expect(claimRoutingFor('Abhishek Thapa', '2026-10-10')).toEqual({ only: ['shubh-convention'] });
    expect(claimRoutingFor('Roopa S', '2026-10-10')).toEqual({ only: ['blvd-club'] });
    expect(claimRoutingFor('Kavya S', '2026-10-10')).toEqual({ exclude: ['shubh-convention', 'blvd-club'] });
    expect(claimRoutingFor('Roopa S', '2026-10-16')).toEqual({ exclude: [] });
  });
});
