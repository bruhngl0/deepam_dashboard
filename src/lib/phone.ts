/**
 * Phone number normalization — the identity key for the entire CRM.
 *
 * Every customer across all four sources (Meta lead forms, WhatsApp broadcast,
 * walk-in onboarding, POS sales) is joined on the output of this module. A bug
 * here silently under-matches leads to sales and understates conversion, so
 * every rule below is derived from values measured in the real source files.
 *
 * See DECISIONS.md D-15 through D-25 for the reasoning behind each rule.
 */

/** Canonical form is E.164 for India: +91 followed by 10 digits. (D-15) */
const COUNTRY_CODE = '91';

export type RejectReason =
  | 'empty'
  | 'foreign'
  | 'junk'
  | 'too_short'
  | 'too_long'
  | 'invalid_prefix';

export type PhoneResult =
  | {
      ok: true;
      /** Canonical identity key, e.g. "+919964767307". */
      e164: string;
      /** 10-digit national form for display and search, e.g. "9964767307". */
      national: string;
      /** True when the source cell held more than one number and we took the first. (D-19) */
      hadMultiple: boolean;
    }
  | {
      ok: false;
      reason: RejectReason;
      /** The input as we received it, for the rejected-rows review panel. (D-25) */
      raw: string;
    };

/** Typed error codes written to import_rows_rejected.error_code. (D-54) */
export const REJECT_CODE: Record<RejectReason, string> = {
  empty: 'phone.empty',
  foreign: 'phone.foreign',
  junk: 'phone.junk',
  too_short: 'phone.too_short',
  too_long: 'phone.too_long',
  invalid_prefix: 'phone.invalid_prefix',
};

/**
 * Placeholder numbers that pass every structural check but are not real. (D-20)
 *
 * `9999999999` is present in the Meta lead data: ten digits, starts with 9, so
 * length and prefix rules both accept it. Left in, it becomes a customer that
 * can match a sale.
 */
function isJunk(national: string): boolean {
  // Two or fewer distinct digits: 9999999999, 9898989898, 8888888889.
  if (new Set(national).size <= 2) return true;

  // Runs of consecutive digits ascending or descending: 1234567890, 9876543210.
  const ASC = '01234567890';
  const DESC = '09876543210';
  if (ASC.includes(national) || DESC.includes(national)) return true;

  return false;
}

/**
 * Strip country and trunk prefixes from a digit string. (D-17)
 *
 * Order matters: 12-digit `91…` must be tested before 11-digit `0…`, or a
 * value like `0919…` peels the wrong prefix and yields nonsense.
 */
function stripPrefixes(digits: string): string {
  if (digits.length === 12 && digits.startsWith(COUNTRY_CODE)) {
    return digits.slice(2); // 919900512580 → 9900512580  (WhatsApp export)
  }
  if (digits.length === 13 && digits.startsWith('0' + COUNTRY_CODE)) {
    return digits.slice(3); // 0919900512580 → 9900512580
  }
  if (digits.length === 11 && digits.startsWith('0')) {
    return digits.slice(1); // 09900512580 → 9900512580  (STD trunk prefix)
  }
  return digits;
}

/** A valid Indian mobile: exactly 10 digits, first digit 6-9, not a placeholder. (D-18, D-20) */
function isValidNational(national: string): boolean {
  return (
    national.length === 10 && /^[6-9]/.test(national) && !isJunk(national)
  );
}

/**
 * Normalize a raw phone value from any of the four sources into E.164.
 *
 * Handles, all measured in the real files:
 *   Meta      "p:+919964767307"            → +919964767307
 *   Meta      "p:9999999999"               → rejected (junk)
 *   Meta      "+919945870456-9741790033"   → +919945870456, hadMultiple
 *   Meta      "+19035212342"               → rejected (foreign)
 *   WhatsApp  "919900512580"               → +919900512580
 *   Walk-in   "9480326706"                 → +919480326706
 *   Sales     9869089495 (number, not str) → +919869089495
 *
 * Never throws. Never returns a partially-valid result. (D-25)
 */
export function normalizePhone(raw: unknown): PhoneResult {
  if (raw === null || raw === undefined) {
    return { ok: false, reason: 'empty', raw: '' };
  }

  // Excel hands back numbers for bare 10-digit cells; String() is safe for both.
  const original = String(raw).trim();

  // Meta's lead-form export prefixes every phone value with "p:". (D-16)
  const source = original.replace(/^p:\s*/i, '').trim();

  if (source === '') {
    return { ok: false, reason: 'empty', raw: original };
  }

  // Try the cell as a single number first. This must come before the split
  // below, or formatting noise ("+91 99005 12580") is torn into fragments and
  // a perfectly good number is rejected.
  const whole = stripPrefixes(source.replace(/\D/g, ''));
  if (isValidNational(whole)) {
    return {
      ok: true,
      e164: `+${COUNTRY_CODE}${whole}`,
      national: whole,
      hadMultiple: false,
    };
  }

  // Only if the cell cannot be read as one number do we treat it as holding
  // several — e.g. the real META value "+919945870456-9741790033". Take the
  // first that validates and flag the row for review. (D-19)
  const candidates = source.split(/[-/,;&|\s]+/).filter(Boolean);
  if (candidates.length > 1) {
    for (const candidate of candidates) {
      const national = stripPrefixes(candidate.replace(/\D/g, ''));
      if (isValidNational(national)) {
        return {
          ok: true,
          e164: `+${COUNTRY_CODE}${national}`,
          national,
          hadMultiple: true,
        };
      }
    }
  }

  return { ok: false, reason: classifyFailure(source), raw: original };
}

/**
 * Explain why nothing validated, so the review panel can group rejects into
 * actionable buckets rather than an undifferentiated "N rows failed". (D-54)
 */
function classifyFailure(source: string): RejectReason {
  const digits = source.replace(/\D/g, '');

  if (digits === '') return 'empty';
  if (digits.length < 10) return 'too_short';

  if (digits.length === 10) {
    // Right length, so it failed on either the placeholder or the prefix rule.
    return isJunk(digits) ? 'junk' : 'invalid_prefix';
  }

  const stripped = stripPrefixes(digits);

  // Reduced to a well-formed Indian mobile, so the junk filter is what
  // rejected it (e.g. "919999999999").
  if (stripped.length === 10 && /^[6-9]/.test(stripped)) return 'junk';

  // E.164 caps a full international number at 15 digits. Anything past that is
  // not a phone number at all.
  if (stripped.length > 15) return 'too_long';

  // Best-effort bucket for "longer than an Indian mobile and not one".
  // Measured in the data: +1 (US), +971 (UAE), +44 (UK), +94 (LK), +60 (MY),
  // +977 (NP), alongside mistyped 11-digit Indian numbers. The label groups the
  // review queue; `raw` is authoritative and a human makes the final call. (D-21, D-25)
  return 'foreign';
}

/**
 * Detect a foreign number well enough to set customers.is_foreign. (D-21)
 *
 * These are real people who filled a real form, so they are stored — but they
 * cannot walk into a Bangalore store, so they are excluded from conversion
 * denominators by default.
 */
export function isForeignNumber(raw: unknown): boolean {
  if (raw === null || raw === undefined) return false;
  const source = String(raw).trim().replace(/^p:\s*/i, '');
  const digits = source.replace(/\D/g, '');
  if (digits.length <= 10) return false;
  return stripPrefixes(digits).length !== 10;
}

/** Format an E.164 value for display: "+919964767307" → "99647 84157". */
export function formatPhoneDisplay(e164: string): string {
  const national = e164.startsWith('+' + COUNTRY_CODE)
    ? e164.slice(3)
    : e164.replace(/\D/g, '');
  if (national.length !== 10) return e164;
  return `${national.slice(0, 5)} ${national.slice(5)}`;
}
