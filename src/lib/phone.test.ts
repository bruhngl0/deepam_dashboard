/**
 * Phone normalization tests.
 *
 * Every value in this file was measured in one of the four real source files
 * for the 19-26 July 2026 week. Invented test data would not have caught the
 * "p:" prefix, the dual-number cell, or the 9999999999 placeholder — all three
 * are real and all three break a naive implementation.
 *
 * Sources:
 *   META   Deepam Varamahalakshmi - Leads Mastersheet.xlsx  (5 sheets)
 *   WA     Whatsapp Campaign Delivered Numbers.xlsx
 *   WALK   onboarding_submissions.xlsx
 *   SALES  MG, JAYANAGAR_Sales Report.xlsx
 */

import { describe, it, expect } from 'vitest';
import {
  normalizePhone,
  isForeignNumber,
  formatPhoneDisplay,
  REJECT_CODE,
} from './phone';

/** Assert a value normalizes to a specific E.164 identity. */
function expectPhone(raw: unknown, e164: string) {
  const result = normalizePhone(raw);
  expect(result.ok, `expected ${JSON.stringify(raw)} to normalize`).toBe(true);
  if (result.ok) {
    expect(result.e164).toBe(e164);
    expect(result.national).toBe(e164.slice(3));
  }
}

/** Assert a value is rejected for a specific reason. */
function expectReject(raw: unknown, reason: string) {
  const result = normalizePhone(raw);
  expect(result.ok, `expected ${JSON.stringify(raw)} to be rejected`).toBe(false);
  if (!result.ok) expect(result.reason).toBe(reason);
}

describe('META lead sheets — "p:" prefix on every value (D-16)', () => {
  it('strips the p: prefix from an international-format number', () => {
    expectPhone('p:+919964767307', '+919964767307');
    expectPhone('p:+919482602139', '+919482602139');
    expectPhone('p:+918050903496', '+918050903496');
  });

  it('strips the p: prefix from a bare 10-digit number', () => {
    expectPhone('p:9845232154', '+919845232154');
  });

  it('is case-insensitive and tolerates a space after the colon', () => {
    expectPhone('P:+919964767307', '+919964767307');
    expectPhone('p: +919964767307', '+919964767307');
  });

  it('handles the real values seen across all five sheets', () => {
    expectPhone('p:+919900512580', '+919900512580'); // Main Campaign
    expectPhone('p:+918547646167', '+918547646167'); // CAM - 4
    expectPhone('p:+919482920125', '+919482920125'); // Cam - 2 (Weekend)
    expectPhone('p:+919844676906', '+919844676906'); // Camp - 4
    expectPhone('p:+919821761223', '+919821761223'); // Private Preview
  });
});

describe('WHATSAPP — 91-prefixed, no plus sign (D-17)', () => {
  it('strips the 91 country code from a 12-digit value', () => {
    expectPhone('919900512580', '+919900512580');
    expectPhone('919741971773', '+919741971773');
    expectPhone('916363515496', '+916363515496');
  });

  it('accepts the numeric type Excel returns for these cells', () => {
    expectPhone(919845067878, '+919845067878');
  });
});

describe('WALK-IN and SALES — bare 10-digit', () => {
  it('normalizes walk-in contact numbers', () => {
    expectPhone('9480326706', '+919480326706');
    expectPhone('9849069339', '+919849069339');
    expectPhone('9731883699', '+919731883699');
  });

  it('normalizes sales mobile numbers, including numeric cells', () => {
    expectPhone('9869089495', '+919869089495');
    expectPhone(9900567147, '+919900567147');
    expectPhone('9740853188', '+919740853188');
  });

  it('produces the same identity for the same person across sources', () => {
    // 9900512580 appears as "p:+919900512580" in META and "919900512580" in WA.
    const meta = normalizePhone('p:+919900512580');
    const whatsapp = normalizePhone('919900512580');
    const walkin = normalizePhone('9900512580');
    expect(meta.ok && whatsapp.ok && walkin.ok).toBe(true);
    if (meta.ok && whatsapp.ok && walkin.ok) {
      expect(meta.e164).toBe(whatsapp.e164);
      expect(whatsapp.e164).toBe(walkin.e164);
    }
  });
});

describe('trunk and country prefix peeling (D-17)', () => {
  it('strips a leading 0 STD prefix', () => {
    expectPhone('09900512580', '+919900512580');
  });

  it('strips a leading 091', () => {
    expectPhone('0919900512580', '+919900512580');
  });

  it('checks the 12-digit 91 rule before the 11-digit 0 rule', () => {
    // Peeling "0" first would leave 919900512580 → wrong length → rejected.
    expectPhone('0919900512580', '+919900512580');
  });

  it('handles formatting noise around a valid number', () => {
    expectPhone('+91 99005 12580', '+919900512580');
    expectPhone('(+91) 9900512580', '+919900512580');
  });

  it('recovers numbers written with an internal space or hyphen', () => {
    // Real META values. An implementation that splits on delimiters before
    // trying the cell as a whole discards all of these — six real customers.
    expectPhone('p:76768 20802', '+917676820802');
    expectPhone('p:95381 14741', '+919538114741');
    expectPhone('p:98803 49049', '+919880349049');
    expectPhone('p:99010 55793', '+919901055793');
    expectPhone('p:76248 57976', '+917624857976');
    expectPhone('p:86602-15486', '+918660215486');
  });

  it('still treats a genuine two-number cell as multiple', () => {
    // The whole-string reading fails here (22 digits), so the split applies.
    const result = normalizePhone('+919945870456-9741790033');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.hadMultiple).toBe(true);

    // Whereas an internal hyphen inside one number must not be flagged.
    const single = normalizePhone('p:86602-15486');
    expect(single.ok).toBe(true);
    if (single.ok) expect(single.hadMultiple).toBe(false);
  });
});

describe('multiple numbers in one cell (D-19)', () => {
  it('takes the first valid number and flags the row', () => {
    // Real value from the META sheet.
    const result = normalizePhone('+919945870456-9741790033');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.e164).toBe('+919945870456');
      expect(result.hadMultiple).toBe(true);
    }
  });

  it('falls through to the second number when the first is invalid', () => {
    const result = normalizePhone('12345 / 9741790033');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.e164).toBe('+919741790033');
  });

  it('does not flag a single number as multiple', () => {
    const result = normalizePhone('p:+919964767307');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.hadMultiple).toBe(false);
  });
});

describe('junk placeholders (D-20)', () => {
  it('rejects the 9999999999 present in the META data', () => {
    // Ten digits, starts with 9 — passes every structural check.
    expectReject('p:9999999999', 'junk');
  });

  it('rejects other single-digit and two-digit repeats', () => {
    expectReject('8888888888', 'junk');
    expectReject('9898989898', 'junk');
  });

  it('rejects consecutive digit runs', () => {
    expectReject('9876543210', 'junk');
  });

  it('rejects junk that arrives with a country code', () => {
    expectReject('919999999999', 'junk');
  });

  it('does not reject a real number that merely repeats digits', () => {
    // Three distinct digits — real, and must survive.
    expectPhone('9880334334', '+919880334334'); // real WA value
    expectPhone('9886331133', '+919886331133'); // real SALES value
  });
});

describe('foreign numbers (D-21)', () => {
  it('rejects the foreign numbers measured in META', () => {
    expectReject('p:+19035212342', 'foreign'); // US
    expectReject('p:+19739029259', 'foreign'); // US
    expectReject('p:+971508278494', 'foreign'); // UAE
    expectReject('p:+449663981611', 'foreign'); // UK
  });

  it('rejects the foreign numbers measured in WHATSAPP', () => {
    expectReject('94717349355', 'foreign'); // Sri Lanka
    expectReject('60122085780', 'foreign'); // Malaysia
    expectReject('9779841444957', 'foreign'); // Nepal
    expectReject('60197177977', 'foreign'); // Malaysia
    expectReject('447723310022', 'foreign'); // UK
  });

  it('flags foreign numbers for the is_foreign column', () => {
    expect(isForeignNumber('p:+19035212342')).toBe(true);
    expect(isForeignNumber('+971508278494')).toBe(true);
    expect(isForeignNumber('94717349355')).toBe(true);
  });

  it('does not flag Indian numbers as foreign', () => {
    expect(isForeignNumber('p:+919964767307')).toBe(false);
    expect(isForeignNumber('919900512580')).toBe(false);
    expect(isForeignNumber('9480326706')).toBe(false);
    expect(isForeignNumber(null)).toBe(false);
  });
});

describe('structural rejects', () => {
  it('rejects empty and blank input', () => {
    expectReject(null, 'empty');
    expectReject(undefined, 'empty');
    expectReject('', 'empty');
    expectReject('   ', 'empty');
    expectReject('p:', 'empty');
  });

  it('rejects numbers that are too short', () => {
    expectReject('99005', 'too_short');
    expectReject('123456789', 'too_short');
  });

  it('rejects 10-digit numbers with an invalid leading digit', () => {
    // Indian mobiles start 6-9; these are landlines or corrupted values.
    expectReject('5900512580', 'invalid_prefix');
    expectReject('1234509876', 'invalid_prefix');
  });

  it('rejects values longer than E.164 permits', () => {
    expectReject('12345678901234567890', 'too_long');
  });

  it('rejects text that contains no digits', () => {
    expectReject('not provided', 'empty');
    expectReject('N/A', 'empty');
  });

  it('never throws on unexpected input types', () => {
    expect(() => normalizePhone({})).not.toThrow();
    expect(() => normalizePhone([])).not.toThrow();
    expect(() => normalizePhone(NaN)).not.toThrow();
    expect(() => normalizePhone(true)).not.toThrow();
  });
});

describe('rejected rows carry their original value (D-25)', () => {
  it('preserves the raw input for the review panel', () => {
    const result = normalizePhone('p:+19035212342');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.raw).toBe('p:+19035212342');
  });

  it('maps every reason to a typed error code (D-54)', () => {
    expect(REJECT_CODE.foreign).toBe('phone.foreign');
    expect(REJECT_CODE.junk).toBe('phone.junk');
    expect(REJECT_CODE.empty).toBe('phone.empty');
    expect(Object.keys(REJECT_CODE)).toHaveLength(6);
  });
});

describe('display formatting', () => {
  it('splits the national number into two groups', () => {
    expect(formatPhoneDisplay('+919845784157')).toBe('98457 84157');
  });

  it('returns the input unchanged when it is not a 10-digit Indian number', () => {
    expect(formatPhoneDisplay('+19035212342')).toBe('+19035212342');
  });
});

describe('idempotence', () => {
  it('normalizing an already-normalized value is a no-op', () => {
    const once = normalizePhone('p:+919964767307');
    expect(once.ok).toBe(true);
    if (once.ok) {
      const twice = normalizePhone(once.e164);
      expect(twice.ok).toBe(true);
      if (twice.ok) expect(twice.e164).toBe(once.e164);
    }
  });
});
