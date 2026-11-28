import { describe, expect, it } from 'vitest';
import { addDays, isBot, parseApplication, parseReferral } from './forms';

const CATEGORIES = ['Makeup artist', 'Loyal Customers'];
import { withPartnerReferral } from './lead';
import { makeLead } from '@/lib/marketing/local';

const reader = (values: Record<string, unknown>) => (key: string) => values[key];

describe('partner application', () => {
  const good = { fullName: '  Priya   Sharma ', contact: '+91 98450 12345', email: 'Priya@Example.com', category: 'Makeup artist', city: 'Bengaluru', consent: 'on' };

  it('accepts a complete form and normalizes the phone and email', () => {
    expect(parseApplication(reader(good), CATEGORIES)).toEqual({ ok: true, value: {
      fullName: 'Priya Sharma', contact: '+91 98450 12345', phone: '+919845012345', email: 'priya@example.com', category: 'Makeup artist', city: 'Bengaluru',
    } });
  });

  it.each([
    [{ fullName: '' }, 'full name'],
    [{ contact: '12345' }, 'mobile number'],
    [{ contact: '9999999999' }, 'mobile number'],
    [{ email: 'not-an-email' }, 'email'],
    [{ category: 'Driver' }, 'category'],
    [{ city: '' }, 'city'],
    [{ consent: undefined }, 'agree'],
  ])('rejects %o', (change, message) => {
    const result = parseApplication(reader({ ...good, ...change }), CATEGORIES);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message.toLowerCase()).toContain(message);
  });

  it('takes consent as true from JSON', () => {
    expect(parseApplication(reader({ ...good, consent: true }), CATEGORIES).ok).toBe(true);
  });

  it('spots the honeypot', () => {
    expect(isBot(reader({ website: 'x' }))).toBe(true);
    expect(isBot(reader({}))).toBe(false);
  });
});

describe('referral registration', () => {
  const today = '2026-11-16';
  const good = { fullName: 'Asha Rao', contact: '9886012345', occasion: 'Wedding', store: 'MG_ROAD', appointmentDate: '2026-11-20', consent: 'on' };

  it('accepts a complete form', () => {
    expect(parseReferral(reader(good), today)).toEqual({ ok: true, value: {
      brand: 'deepam', fullName: 'Asha Rao', contact: '9886012345', phone: '+919886012345', occasion: 'Wedding', storeCode: 'MG_ROAD', appointmentDate: '2026-11-20',
    } });
  });

  it('takes a Kalaniketan store when the brand is Kalaniketan', () => {
    const r = parseReferral(reader({ ...good, brand: 'kalaniketan', store: 'KN_SURAT' }), today);
    expect(r.ok && [r.value.brand, r.value.storeCode]).toEqual(['kalaniketan', 'KN_SURAT']);
  });

  it("refuses a store of the other brand, and an unknown brand", () => {
    expect(parseReferral(reader({ ...good, brand: 'kalaniketan' }), today).ok).toBe(false);
    const r = parseReferral(reader({ ...good, brand: 'Taneira' }), today);
    expect(!r.ok && r.message).toContain('brand');
  });

  it('accepts the store by its name, as the deepam.com form may send it', () => {
    const r = parseReferral(reader({ ...good, store: 'Jayanagar' }), today);
    expect(r.ok && r.value.storeCode).toBe('JAYANAGAR');
  });

  it.each([
    [{ appointmentDate: '2026-11-15' }, 'between today'],
    [{ appointmentDate: addDays(today, 91) }, 'between today'],
    [{ appointmentDate: '20/11/2026' }, 'appointment date'],
    [{ store: 'Chennai' }, 'store'],
    [{ occasion: 'Shopping' }, 'occasion'],
    [{ consent: '' }, 'contact you'],
  ])('rejects %o', (change, message) => {
    const result = parseReferral(reader({ ...good, ...change }), today);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message.toLowerCase()).toContain(message);
  });

  it('accepts today and the last allowed day', () => {
    expect(parseReferral(reader({ ...good, appointmentDate: today }), today).ok).toBe(true);
    expect(parseReferral(reader({ ...good, appointmentDate: addDays(today, 90) }), today).ok).toBe(true);
  });

  it('adds days across a month end', () => {
    expect(addDays('2026-11-16', 60)).toBe('2027-01-15');
  });
});

describe('partner referral lead', () => {
  const ref = { phone: '+919886012345', name: 'Asha Rao', partnerCode: 'DPR-00001', partnerName: 'Priya Sharma', partnerCategory: 'Makeup artist',
    occasion: 'Wedding', store: 'MG', storeLabel: 'MG Road', appointmentDate: '2026-11-20' };
  const now = new Date('2026-11-16T05:00:00Z'); // 10:30 IST

  it('makes a Referral lead with the Partner ID as its campaign and a follow-up in an hour', () => {
    const lead = withPartnerReferral(null, ref, now);
    expect(lead).toMatchObject({ source: 'Referral', campaignId: 'DPR-00001', preferredStore: 'MG', intent: 'Wedding', tags: ['partner'], visitDay: 'Friday, 20 November' });
    expect(lead.acquisitions).toHaveLength(1);
    expect(lead.followups).toHaveLength(1);
    expect(lead.followups[0].due).toBe('2026-11-16T11:30');
    expect(lead.followups[0].note).toContain('DPR-00001');
  });

  it('keeps an existing lead, adds the referral source once and does not stack follow-ups', () => {
    const existing = makeLead({ phone: ref.phone, name: 'Asha', source: 'Meta ads', campaignId: 'CAM-1', preferredStore: 'JAYNAGAR' });
    const once = withPartnerReferral(existing, ref, now);
    const twice = withPartnerReferral(once, { ...ref, occasion: 'Festival' }, now);
    expect(twice.source).toBe('Meta ads');
    expect(twice.name).toBe('Asha');
    expect(twice.preferredStore).toBe('JAYNAGAR');
    expect(twice.acquisitions.map((a) => a.source)).toEqual(['Meta ads', 'Referral']);
    expect(twice.followups).toHaveLength(1);
    expect(twice.followups[0].note).toContain('Festival');
    expect(twice.interactions).toHaveLength(existing.interactions.length + 2);
  });
});

describe('Partner ID', () => {
  it('reads old DPR- IDs as APR-, and leaves others alone', async () => {
    const { normalizePartnerCode, PARTNER_CODE } = await import('./constants');
    expect(normalizePartnerCode(' dpr-00003 ')).toBe('APR-00003');
    expect(normalizePartnerCode('APR-00033')).toBe('APR-00033');
    expect(PARTNER_CODE.test('APR-00033')).toBe(true);
    expect(PARTNER_CODE.test('DPR-00033')).toBe(false);
  });
});
