/**
 * Sheet/source → seeded campaign name.
 *
 * Single definition, shared by the CLI (`scripts/import-leads.ts`) and the
 * upload UI's server actions (`actions.ts`). Duplicating this map is exactly
 * the mistake that let two attribution implementations drift apart during
 * Phase 4 — see DECISIONS.md's note on `verify-source-data.ts`. One copy only.
 */

/** Meta workbook sheet name → seeded campaign name. (D-07) */
export const META_SHEET_CAMPAIGNS: Record<string, string> = {
  'Main Campaign': 'Varamahalakshmi — Main Campaign',
  'CAM - 4 (25th - 27th )': 'Varamahalakshmi — CAM 4 (25-27 Jul)',
  'Cam - 2 (Weekend)': 'Varamahalakshmi — Cam 2 (Weekend)',
  'Camp - 4': 'Varamahalakshmi — Camp 4',
  'Private Preview': 'Varamahalakshmi — Private Preview',
};

export const WHATSAPP_CAMPAIGN = 'Varamahalakshmi — WhatsApp Broadcast';
export const WALKIN_CAMPAIGN = 'Store Walk-in Onboarding';

/** Look up the campaign for a Meta sheet, tolerating incidental whitespace. */
export function metaCampaignForSheet(sheetName: string): string | undefined {
  return META_SHEET_CAMPAIGNS[sheetName.trim()];
}
