/**
 * Import lead sources.
 *
 *   npx tsx scripts/import-leads.ts meta     "<file.xlsx>" [--commit]
 *   npx tsx scripts/import-leads.ts whatsapp "<file.xlsx>" [--commit]
 *   npx tsx scripts/import-leads.ts walkin   "<file.xlsx>" [--commit]
 *   npx tsx scripts/import-leads.ts all                    [--commit]
 *
 * `all` imports every source from ~/Downloads in the order that produces the
 * best data: walk-ins first (highest-trust names), then Meta, then WhatsApp.
 * Order does not affect correctness — lifecycle is recomputed from scratch
 * every time (D-38) — only which spelling of a name survives (D-24).
 *
 * Preview writes nothing. (D-58)
 */

import '../src/db/load-env';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import {
  parseMetaSheet,
  parseWhatsappSheet,
  parseWalkinSheet,
  listSheets,
  type LeadParseResult,
} from '../src/lib/parsers/leads';
import {
  previewLeadImport,
  commitLeadImport,
  type LeadChannel,
} from '../src/lib/import/leads';
import {
  metaCampaignForSheet,
  WHATSAPP_CAMPAIGN,
  WALKIN_CAMPAIGN,
} from '../src/lib/import/campaign-map';

const DEFAULT_FILES = {
  meta: 'Deepam Varamahalakshmi - Leads Mastersheet.xlsx',
  whatsapp: 'Whatsapp Campaign Delivered Numbers.xlsx',
  walkin: 'onboarding_submissions.xlsx',
};

const commit = process.argv.includes('--commit');
let totalCommitted = 0;

async function runOne(
  parsed: LeadParseResult,
  fileBuffer: Buffer,
  fileName: string,
  channel: LeadChannel,
  campaignName: string,
) {
  const preview = await previewLeadImport(parsed, {
    fileBuffer,
    fileName,
    channel,
    campaignName,
  });
  const s = preview.summary;

  console.log(`\n  ${channel.toUpperCase()}  ·  "${preview.sheetName}"  →  ${campaignName}`);
  console.log(
    `    rows ${String(s.dataRows).padStart(5)}   valid ${String(s.valid).padStart(5)}` +
      `   unique ${String(s.uniquePhones).padStart(5)}` +
      `   dupes ${String(s.duplicatesInFile).padStart(5)}` +
      `   rejected ${String(s.rejected).padStart(3)}`,
  );
  console.log(
    `    new customers ${String(s.newCustomers).padStart(5)}` +
      `   already known ${String(s.existingCustomers).padStart(5)}` +
      `   timestamps ${s.timestampsEstimated ? 'ESTIMATED (D-30)' : 'real'}`,
  );
  if (s.rejected > 0) {
    const codes = Object.entries(s.rejectsByCode)
      .map(([c, n]) => `${c}=${n}`)
      .join('  ');
    console.log(`    rejects: ${codes}`);
  }
  if (s.alreadyImported) {
    console.log('    ⚠ this sheet has been committed before — re-import is a no-op');
  }

  if (!commit) return;

  const r = await commitLeadImport(preview, 'cli');
  console.log(
    `    ✓ customers ${r.customersUpserted}   touches +${r.touchesInserted} ` +
      `(${r.touchesSkipped} existing)   followups ${r.followupsInserted}` +
      (r.submissionsInserted ? `   submissions ${r.submissionsInserted}` : '') +
      `   rejects stored ${r.rejectedStored}`,
  );
  totalCommitted += r.touchesInserted;
}

async function importMeta(path: string) {
  const buffer = readFileSync(path);
  const name = basename(path);
  for (const sheet of listSheets(buffer)) {
    const campaign = metaCampaignForSheet(sheet);
    if (!campaign) {
      console.log(`\n  META  ·  "${sheet}"  →  no campaign mapping, skipped`);
      continue;
    }
    await runOne(parseMetaSheet(buffer, sheet), buffer, name, 'meta', campaign);
  }
}

async function importWhatsapp(path: string) {
  const buffer = readFileSync(path);
  await runOne(
    parseWhatsappSheet(buffer),
    buffer,
    basename(path),
    'whatsapp',
    WHATSAPP_CAMPAIGN,
  );
}

async function importWalkin(path: string) {
  const buffer = readFileSync(path);
  await runOne(
    parseWalkinSheet(buffer),
    buffer,
    basename(path),
    'walkin',
    WALKIN_CAMPAIGN,
  );
}

async function main() {
  const mode = process.argv[2];
  const path = process.argv[3]?.startsWith('--') ? undefined : process.argv[3];
  const downloads = join(process.env.HOME ?? '', 'Downloads');

  if (!mode) {
    console.error(
      'Usage: npx tsx scripts/import-leads.ts <meta|whatsapp|walkin|all> [file] [--commit]',
    );
    process.exit(1);
  }

  if (mode === 'all') {
    // Walk-in first so its customer-typed names win the D-24 trust comparison.
    await importWalkin(path ?? join(downloads, DEFAULT_FILES.walkin));
    await importMeta(join(downloads, DEFAULT_FILES.meta));
    await importWhatsapp(join(downloads, DEFAULT_FILES.whatsapp));
  } else if (mode === 'meta') {
    await importMeta(path ?? join(downloads, DEFAULT_FILES.meta));
  } else if (mode === 'whatsapp') {
    await importWhatsapp(path ?? join(downloads, DEFAULT_FILES.whatsapp));
  } else if (mode === 'walkin') {
    await importWalkin(path ?? join(downloads, DEFAULT_FILES.walkin));
  } else {
    console.error(`Unknown mode: ${mode}`);
    process.exit(1);
  }

  console.log(
    commit
      ? `\n  ✓ committed — ${totalCommitted} new lead touches, lifecycle recomputed\n`
      : '\n  Preview only. Re-run with --commit to write.\n',
  );
}

main().catch((e) => {
  console.error('\nImport failed:', e.message);
  process.exit(1);
});
