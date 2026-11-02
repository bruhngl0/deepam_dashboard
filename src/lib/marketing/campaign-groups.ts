/**
 * Campaigns that are reported as one. The three Varamahalakshmi Meta campaigns
 * (0006, 0007, 0008) were one festival push, so every campaign table, report
 * and label shows them as one campaign. A lead keeps its own campaign ID; only
 * what is shown and summed changes. No database import: client code uses it.
 */

type Group = { name: string; platform: RegExp; codes: string[] };

const GROUPS: Group[] = [
  { name: 'Meta | Varamahalakshmi (0006, 0007, 0008)', platform: /^meta$/i, codes: ['0006', '0007', '0008'] },
];

const parts = (campaign: string) => campaign.split('|').map((part) => part.trim());

function groupFor(campaign: string): Group | undefined {
  const trimmed = campaign.trim();
  const byName = GROUPS.find((g) => g.name.toLowerCase().replace(/\s+/g, '') === trimmed.toLowerCase().replace(/\s+/g, ''));
  if (byName) return byName;
  const [platform, code] = parts(trimmed);
  return GROUPS.find((g) => g.platform.test(platform ?? '') && g.codes.includes(code ?? ''));
}

/** The campaign as reported: a merged group's name, or the campaign itself (trimmed). */
export function campaignGroup(campaign: string): string {
  return groupFor(campaign)?.name ?? campaign.trim();
}

/**
 * For SQL: the campaign numbers a merged group covers (`null` for an ordinary campaign),
 * so a query can match its members by number rather than by exact name.
 */
export function campaignGroupCodes(campaign: string): string[] | null {
  return groupFor(campaign)?.codes ?? null;
}
