# Deepam CRM

Multi-channel lead → sale attribution CRM for Deepam (Ananta Silk Weaves Pvt Ltd).
Ingests the cleaned master lead workbook (Meta, WhatsApp, Google Ads, Others) and POS sales, resolves them all to a single customer identity by phone number, and reports what each channel actually produced. The original per-channel export parsers are kept — see D-84 for what replaced them and what that cost.

**Documentation**

| Document | What's in it |
|---|---|
| [`SYSTEM_DESIGN.md`](./SYSTEM_DESIGN.md) | Architecture, schema, ingestion pipeline, metric definitions |
| [`DECISIONS.md`](./DECISIONS.md) | Every rule decided (D-01…D-92), its evidence, confidence and reversal cost |

Code comments reference decision IDs — `// D-20: junk placeholder filter` — so a rule can always be traced back to the reasoning and the data behind it.

---

## Setup

```bash
npm install
cp .env.example .env.local        # add your Neon connection string
npm run db:migrate                # create schema + attribution view
npm run db:seed                   # stores and campaigns
npm run dev
```

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm test` | Unit tests (phone normalization) |
| `npm run db:generate` | Generate a migration from schema changes |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:seed` | Seed stores and campaigns (idempotent) |
| `npm run db:studio` | Drizzle Studio |
| `npx tsx scripts/db-status.ts` | Show tables, views, enums, seeded data and settings |
| `npx tsx scripts/import-master-sheet.ts "<file.xlsx>" [--commit]` | Replace the lead layer from the master workbook (D-84) — preview by default. Same logic as the `/import` page (D-89). |
| `npx tsx scripts/import-sales.ts "<file>" [--commit]` | Import a POS sales report (preview by default) |
| `npx tsx scripts/rollback-batch.ts [batch-id]` | List import batches, or roll one back |
| `npx tsx scripts/verify-source-data.ts` | **Regression check: parser vs. the real files** |
| `npx tsx scripts/import-leads.ts <meta\|whatsapp\|walkin\|all> [--commit]` | Import lead sources |
| `npx tsx scripts/verify-db.ts` | **Regression check: what actually landed in the database** |
| `npx tsx scripts/verify-metrics.ts` | **Acceptance test: dashboard KPIs vs. the design docs** |

## Verifying the ingestion layer

`scripts/verify-source-data.ts` runs `src/lib/phone.ts` over the four real spreadsheets and asserts every figure quoted in the design docs. Run it after any change to phone normalization or parsing:

```
847 bills   ·   ₹2,01,03,733 gross   ·   650 unique sale phones   ·   66 phone-less bills
```

If those four reconcile, the hardest part of the pipeline is correct. It expects the source files in `~/Downloads`; pass a directory to override.

## Project structure

```
src/
  app/page.tsx            Dashboard (Server Component, reads straight from SQL)
  app/insights/            Live findings + build roadmap (numbers queried, not typed)
  app/import/              Master-sheet upload — preview, then a gated commit (D-89)
  app/api/import/          preview/ (safe) and commit/ (ALLOW_MASTER_SHEET_IMPORT-gated) routes
  app/api/customers/export/  CSV export, same filters as the customer table (D-76)
  components/              Stat tiles, channel chart, branch×channel matrix, customer
                           value tiers, customer table, filters, import form
  lib/phone.ts            Identity resolution — the join key for the whole system
  lib/excel.ts            Serial-date + header-mapping helpers (timezone-safe)
  lib/format.ts           Indian digit grouping, IST rendering, value-tier labels
  lib/csv.ts              RFC 4180 CSV encoding for the export route
  lib/parsers/            sales.ts · leads.ts (Meta, WhatsApp, walk-in — superseded, D-84)
  lib/import/              master-sheet.ts (parse + commit, shared by the CLI and the API
                           routes, D-89) · leads.ts · sales.ts (two-phase preview/commit)
  lib/queries/             One definition of every metric (D-76): dashboard.ts (DateRange,
                           value tiers, branch×channel), customers.ts, insights.ts
  db/                     Drizzle schema, clients, seed
drizzle/
  0000  tables, enums, indexes            0004  prior_purchase window fix
  0001  attribution view + settings       0005  real timestamps beat estimates
  0002  prior_purchase basis fix          0006  master-sheet channel priority (D-85)
  0003  name trust order (D-24)           0007  attribution window enforced (D-92)
scripts/
  import-master-sheet.ts · import-sales.ts · import-leads.ts · rollback-batch.ts
  verify-source-data.ts · verify-db.ts · verify-metrics.ts · db-status.ts
```

## Status

| Phase | State |
|---|---|
| 0 · Foundation — scaffold, schema, migrations, seed | **done** |
| 1 · Phone normalization + tests | **done** |
| 2 · Sales importer | **done** — 847 bills, ₹2,01,03,733, 650 customers, 66 phone-less |
| 3 · Lead importers (Meta ×5, WhatsApp, walk-in) | **superseded** by the master-sheet importer (D-84) |
| 3b · Master-sheet importer | **done** — 5,866 leads, 6,167 touches, 4 channels |
| 4 · Lifecycle, attribution, KPI queries | **done** — `verify-metrics.ts` passes; attribution window enforced (D-92) |
| 5 · Dashboard + customer table UI | **done** — KPI row, channel chart, branch×channel matrix (D-87), value columns (D-88), customer value tiers (D-90), date range filter (D-91), data-quality panel, filters |
| 5b · Insights route | **done** — live findings + build roadmap at `/insights` |
| 6 · Import UI | **done** — `/import`: preview always works, commit gated by `ALLOW_MASTER_SHEET_IMPORT` until auth exists (D-89) |
| 6b · CSV export | **done** — `/api/customers/export`, same filters as the customer table |
| 7 · Auth | **not started** — the dashboard, Insights and Import pages are all reachable with no login. See D-89: this is why the import commit path is env-gated rather than trusting the UI. |

Phases 0–4 are the system; 5–7 are surface. Phase 4 is done when `npx tsx scripts/verify-metrics.ts` passes — that script, not `SYSTEM_DESIGN.md` §2.3, is the maintained baseline.

**Current database state** — the cleaned master workbook, all four channels reporting:

```
Total Leads 5,866  ·  Converted 366  ·  CVR 6.24%  ·  Gross ₹2,01,03,733
whatsapp 3,562 /  46 buyers /  1.29%    existing (inferred)  284 / 284
meta     1,924 / 150 buyers /  7.80%    phone-less bills      66 / ₹17,16,361
other      367 / 164 buyers / 44.69%
google      13 /   6 buyers / 46.15%
```

`other` is store-sourced and is mostly people who had already bought, which is why the
blended rate reads 6.24% against 1.29–7.80% for the digital channels. Read the channel
rows, not the headline, to judge acquisition (D-86).
