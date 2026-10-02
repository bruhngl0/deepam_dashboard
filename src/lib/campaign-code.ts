/**
 * Campaign IDs are pre-given and typed in by hand (drizzle/0015). Mirrors the
 * `campaigns_campaign_code_format` CHECK so a bad value is a 400, not a 500.
 */
export const CAMPAIGN_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_/-]{0,39}$/;

/** Trimmed code, `null` for blank, or `undefined` when the value is invalid. */
export function parseCampaignCode(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return CAMPAIGN_CODE_PATTERN.test(trimmed) ? trimmed : undefined;
}
