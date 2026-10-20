import { describe, expect, it } from 'vitest';
import { makeLead } from './local';
import { claimRoutingFor, routeActive, routeForTab, routeSheetLead } from './sheet-routing';

describe('temporary campaign routing', () => {
  it('matches the live worksheet names without depending on case or punctuation', () => {
    expect(routeForTab('Shubh Convention Lead- Oct')?.salesperson).toBe('Abhishek Thapa');
    expect(routeForTab('SHUBH convention_lead Oct')?.group).toBe('shubh-convention');
    expect(routeForTab('BLVD Club (Blr) Lead- Oct')?.salesperson).toBe('Roopa S');
    expect(routeForTab('Virtual calls - SEP.')?.salesperson).toBe('Sandhya');
    expect(routeForTab('Virtual calls - Oct')?.group).toBe('virtual-calls');
    expect(routeForTab('The Residency (Chennai) Lead- Oct')?.salesperson).toBe('Margaret Prema');
    expect(routeForTab('Store lead campaign- Oct')).toBeUndefined();
  });

  it('is active through the configured end date and stops the next day', () => {
    const route = routeForTab('Shubh Convention Lead- Oct')!;
    expect(routeActive(route, '2026-10-18')).toBe(true);
    expect(routeActive(route, '2026-10-19')).toBe(false);
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

  it('leaves a lead that was moved by hand with its new salesperson', () => {
    const lead = { ...makeLead({ phone: '+919000123411', name: 'Meena', source: 'Meta ads' }), claimedBy: 'Roopa S', claimedAt: '2026-10-20T15:00:00', claimPinned: true };
    const route = routeForTab('The Residency (Chennai) Lead- Oct')!;
    const routed = routeSheetLead(lead, 'The Residency (Chennai) Lead- Oct', route, '2026-10-20T15:05:00', true);
    expect(routed).toMatchObject({ claimedBy: 'Roopa S', claimedAt: '2026-10-20T15:00:00', claimGroup: 'chennai' });
    // Without the pin, the same lead goes back to the route's salesperson.
    expect(routeSheetLead({ ...lead, claimPinned: undefined }, 'The Residency (Chennai) Lead- Oct', route, '2026-10-20T15:05:00', true).claimedBy).toBe('Margaret Prema');
  });

  it('keeps Roopa to BLVD Club, Sandhya to Virtual calls, gives Abhishek and Margaret the pool with their routes first, and keeps others out', () => {
    expect(claimRoutingFor('Roopa S', '2026-10-10')).toEqual({ only: ['blvd-club'] });
    expect(claimRoutingFor('Sandhya', '2026-10-10')).toEqual({ only: ['virtual-calls'] });
    expect(claimRoutingFor('Sandhya', '2027-06-01')).toEqual({ only: ['virtual-calls'] });
    expect(claimRoutingFor('Abhishek Thapa', '2026-10-10')).toEqual({ exclude: ['blvd-club', 'virtual-calls', 'chennai'], first: ['shubh-convention'] });
    expect(claimRoutingFor('Kavya S', '2026-10-10')).toEqual({ exclude: ['shubh-convention', 'blvd-club', 'virtual-calls', 'chennai'], first: [] });
    expect(claimRoutingFor('Margaret Prema', '2026-10-14')).toEqual({ exclude: ['shubh-convention', 'blvd-club', 'virtual-calls'], first: ['chennai'] });
    expect(claimRoutingFor('Chennai', '2026-10-14')).toEqual({ exclude: ['shubh-convention', 'blvd-club', 'virtual-calls', 'chennai'], first: [] });
    expect(claimRoutingFor('Roopa S', '2026-10-18')).toEqual({ only: ['blvd-club'] });
    expect(claimRoutingFor('Roopa S', '2026-10-19')).toEqual({ exclude: ['virtual-calls', 'chennai'], first: [] });
  });
});
