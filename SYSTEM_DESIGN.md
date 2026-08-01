# Deepam CRM — System Design & Architecture

**Version:** 1.0
**Date:** 2026-07-29
**Owner:** Deepam (Ananta Silk Weaves Private Limited)
**Scope:** Multi-channel lead → sale attribution CRM for saree retail (MG Road + Jayanagar stores)
**Companion:** [`DECISIONS.md`](./DECISIONS.md) — every rule decided, its evidence, confidence level and reversal cost (D-01…D-82)

---

## 1. Problem statement

Deepam runs three lead-generation channels that produce data in three unrelated formats:

| Channel | Source | What it produces |
|---|---|---|
| Meta Ads (Instagram) | Lead-gen form exports | Name, email, phone, preferred store, visit date/slot, tele-calling follow-up notes |
| WhatsApp campaign | Broadcast delivery report | Phone number only |
| Store walk-ins | In-store onboarding form | Name, phone, email, area, city, DOB, anniversary, how-they-heard, purpose of visit, store |

Sales come from a fourth system — the billing/POS export (`Sales List`), keyed on customer mobile number.

There is currently no way to answer: *how many people did we reach, how many bought, how much did they spend, and which channel produced them.* Every sheet lives in isolation and the phone number is the only field they share.

**Goal:** one system that ingests all four feeds, resolves them to a single customer identity via phone number, and renders a dashboard showing **Total Leads → Leads Converted → Total Sales → Conversion Rate**, plus a searchable, filterable customer table with per-customer detail.

---

## 2. Data reality (measured, not assumed)

I parsed all four files before designing the schema. These are actual figures from the 19–26 July 2026 week. **The design decisions below exist because of these specific findings.**

### 2.1 Source files

| File | Sheets | Rows | Unique valid phones |
|---|---|---|---|
| `Deepam Varamahalakshmi - Leads Mastersheet.xlsx` | 5 | 2,020 | 1,736 |
| `Whatsapp Campaign Delivered Numbers.xlsx` | 1 (`Sheet1`) | 6,962 | 3,696 |
| `onboarding_submissions.xlsx` (walk-ins) | 1 | 820 | 741 |
| `MG, JAYANAGAR_Sales Report.xlsx` | 1 | 847 bills | 650 |

> **Confirmed 2026-07-29:** `onboarding_submissions.xlsx` is the store walk-in / onboarding feed. All figures in this document already use it.

### 2.2 The five problems the schema has to solve

**(a) Phone numbers arrive in four incompatible formats.**

```
Meta:      p:+919964767307    p:9999999999    +19035212342    +919945870456-9741790033
WhatsApp:  919900512580       (bare, 91-prefixed, no +)
Walk-in:   9480326706         (bare 10-digit)
Sales:     9869089495         (bare 10-digit, 66 bills have none at all)
```

Found in the wild: a `p:` prefix on every Meta value, international numbers (US `+1`, UAE `+971`, UK `+44`, Sri Lanka `+94`, Malaysia `+60`, Nepal `+977`), two numbers jammed into one cell separated by a hyphen, and junk placeholders like `9999999999`. A naive `strip + compare` join silently loses ~1.5% of leads and produces false matches. **Normalization is the single highest-risk component in this system** — §4 specifies it precisely.

**(b) The Meta workbook is five different schemas, not one.**

The five sheets (`Main Campaign`, `CAM - 4 (25th - 27th )`, `Cam - 2 (Weekend)`, `Camp - 4`, `Private Preview`) have different, differently-cased, differently-ordered column sets. `Main Campaign` uses `Phone_number`; `Private Preview` uses `phone`. Three sheets have a visit-date column, two don't. The importer must map columns by fuzzy header match, not by position.

**(c) The sales file contains two branches disambiguated only by voucher prefix.**

The header reads `Branch : MG, JAYANAGAR`, but there is no branch column. Two voucher prefixes interleave across all 8 days:

| Prefix | Bills | Revenue | Salesman codes |
|---|---|---|---|
| `BK01-` | 505 | ₹1,33,69,360 | 321, 105, 319, 287, 23, 414 … |
| `BK02-` | 342 | ₹67,34,373 | 06, 285, 280, 230, 272, 304 … |

The two salesman-code pools are **completely disjoint**, which confirms prefix → branch is a stable mapping.

**Resolved from the data: `BK01-` = MG Road, `BK02-` = Jayanagar.** Cross-referencing customers who filled a walk-in form at a named store and then appear on a bill:

| | Declared MG Road | Declared Jayanagar |
|---|---|---|
| Billed on `BK01-` | **146** | 6 |
| Billed on `BK02-` | 0 | **214** |

The Meta lead forms' `preferred_store` field corroborates independently (`BK01-`: 32 MG vs 4 Jayanagar; `BK02-`: 32 Jayanagar vs 4 MG). The handful of crossovers are people who named one store and shopped at the other — expected, and not enough to challenge the mapping. Seed it into `stores.voucher_prefix` and **have the store manager confirm once** before Phase 2 signs off; the evidence is strong but it costs nothing to verify.

Two consequences: the export **does** cover both branches (no missing Jayanagar file), and **MG Road out-bills Jayanagar 2:1 in revenue** (₹1.34 Cr vs ₹67.3 L) despite Jayanagar collecting more walk-in forms (437 vs 314). That inversion is worth a look on its own.

**(d) 66 of 847 bills (7.8%) have no usable phone number**, worth ₹17,16,361. These can never be attributed to any customer. They must still count toward gross revenue but be excluded from the conversion denominator — otherwise the conversion rate is quietly wrong. Same for 50 bills with no customer name.

**(e) Leads overlap across channels.** 301 phone numbers appear in more than one source (Meta ∩ WhatsApp = 198, Meta ∩ walk-in = 80, WhatsApp ∩ walk-in = 35, all three = 6). Summing per-channel lead counts double-counts them. This forces an explicit attribution model (§6).

### 2.3 What the answers actually look like

Running the full pipeline over this week's data, with buyers who match no lead record classified as **existing customers** (§6.1):

| Segment | People | Buyers | CVR | Revenue |
|---|---|---|---|---|
| Meta (Instagram) | 1,654 | 29 | 1.8% | ₹8,49,449 |
| WhatsApp | 3,471 | 8 | 0.2% | ₹2,54,786 |
| Walk-in | 598 | 257 | 43.0% | ₹66,43,784 |
| Existing — declared | 143 | 72 | 50.3% | ₹27,19,335 |
| Existing — inferred | 284 | 284 | *100%* | ₹79,20,018 |
| **Total** | **6,150** | **650** | — | **₹1,83,87,372** |
| Bills with no phone | — | 66 bills | — | ₹17,16,361 |
| **Gross billed** | | **847 bills** | | **₹2,01,03,733** |

Four things worth knowing before you build:

1. **Existing customers are 58% of revenue.** Split into an acquisition funnel and a retention view, the week looks like this:

   | | People | Buyers | CVR | Revenue |
   |---|---|---|---|---|
   | **New (acquisition)** | 5,723 | 294 | 5.1% | ₹77,48,019 (42%) |
   | **Existing (retention)** | 427 | 356 | 83.4% | ₹1,06,39,353 (58%) |

   These are two different businesses and one blended conversion rate hides both.

2. **Never put inferred-existing customers in the conversion denominator.** That group is *defined by* having a sale, so its conversion rate is 100% by construction. Blending it in moves the headline rate from 5.1% to 10.6% — a number that rises whenever lead capture gets worse. §7 keeps the denominators separate for this reason.

3. **Under any-touch counting Meta converts 85 customers; under exclusive attribution, 29.** The other 56 also filled the in-store walk-in form. Both figures are defensible, which is why §6 keeps every touch rather than stamping one source onto the customer row.

4. **The walk-in form is the highest-signal source; WhatsApp broadcast is close to noise** (0.2%). The dashboard should make that obvious rather than average it away.

Self-reported acquisition source from the walk-in form, as a cross-check on channel quality:

| how_did_you_hear | Leads | Buyers | CVR | Revenue |
|---|---|---|---|---|
| Existing Customer | 143 | 72 | 50.3% | ₹27,19,335 |
| Walk-in | 171 | 85 | 49.7% | ₹17,89,941 |
| Instagram | 205 | 77 | 37.6% | ₹18,28,302 |
| WhatsApp | 118 | 58 | 49.2% | ₹15,35,714 |
| Friend / Family | 50 | 18 | 36.0% | ₹4,88,658 |
| Facebook | 9 | 7 | 77.8% | ₹3,59,302 |
| Other / Google / Billboard / Apartment ad | 73 | 34 | 46.6% | ₹12,73,648 |

Note the tension: 205 walk-in visitors say they came from Instagram, but only ~1,650 Meta leads exist in the ad exports and just 80 phones appear in both. Self-reported source and tracked source disagree, and the schema stores both rather than picking a winner.

---

## 3. Tech stack

**Recommendation: Next.js (App Router) on Vercel + Neon Postgres + Drizzle ORM.** Built on Next 16.2 + React 19.2.

| Layer | Choice | Why |
|---|---|---|
| App / API | Next.js 16, App Router, Server Components | One deployable for UI + API. Server Components render the customer table directly from SQL — no client-side data fetching layer to build. |
| Runtime | Node.js (not Edge) for import routes | XLSX parsing needs Node buffers and more CPU than the Edge runtime allows. |
| DB | Neon Postgres (serverless) | Real SQL — the whole product is aggregation and joins. Branching is genuinely useful here: fork prod to test a risky import. Scale-to-zero fits an internal tool used a few hours a day. |
| DB access | Drizzle ORM + `@neondatabase/serverless` | Typed schema, SQL-first (you will write window functions and CTEs; Prisma fights you on those). HTTP driver avoids connection-pool exhaustion in serverless. |
| Parsing | SheetJS (`xlsx`) | Reads `.xlsx` and `.csv`; handles the multi-sheet Meta workbook natively. |
| UI | Tailwind + shadcn/ui, TanStack Table | Matches the reference screenshot's aesthetic with minimal custom CSS. |
| Auth | Auth.js (email magic link) or Clerk | Small fixed set of internal users. |
| Files | Vercel Blob (or direct-to-Neon if <4 MB) | Keeps the original upload for audit and re-processing. |

**Why not Cloudflare Workers + Neon:** it would work, but Workers' CPU-time ceiling makes the 6,950-row WhatsApp import a chunking exercise you don't need to do; you'd build the UI in a separate framework anyway; and file upload + background job ergonomics are meaningfully worse. Choose Workers only if you later need sub-50ms global reads, which an internal two-store CRM does not.

**Sizing note:** this dataset is ~10k rows/week. At 52 weeks that's ~500k rows. This is a single small Postgres instance for years. Do not over-engineer for scale — engineer for *data-quality resilience*, which is where this problem is actually hard.

---

## 4. Identity resolution — the core algorithm

Everything depends on this. It gets its own module (`lib/phone.ts`), its own unit-test suite, and it runs identically at import time and query time.

### 4.1 Normalization

Canonical form: **E.164** — `+91XXXXXXXXXX`. Stored in `customers.phone_e164`, `UNIQUE NOT NULL`.

```ts
type PhoneResult =
  | { ok: true;  e164: string; national: string }
  | { ok: false; reason: 'empty'|'multiple'|'foreign'|'junk'|'too_short'|'too_long'|'invalid_prefix' };

function normalizePhone(raw: unknown): PhoneResult {
  if (raw == null) return { ok: false, reason: 'empty' };

  // 1. Strip the Meta lead-form 'p:' prefix and surrounding whitespace.
  let s = String(raw).trim().replace(/^p:\s*/i, '');
  if (!s) return { ok: false, reason: 'empty' };

  // 2. A cell may hold two numbers ('+919945870456-9741790033').
  //    Split on separators; take the first candidate that validates.
  const candidates = s.split(/[-/,;&\s]+/).filter(Boolean);
  const multiple = candidates.length > 1;

  for (const c of candidates) {
    const d = c.replace(/\D/g, '');
    let n = d;

    // 3. Peel country/trunk prefixes, longest first.
    if (n.length === 12 && n.startsWith('91'))  n = n.slice(2);   // 919900512580
    else if (n.length === 13 && n.startsWith('091')) n = n.slice(3);
    else if (n.length === 11 && n.startsWith('0'))   n = n.slice(1);

    if (n.length !== 10) continue;
    if (!/^[6-9]/.test(n)) continue;              // Indian mobiles start 6-9

    // 4. Junk filter: 9999999999, 1234567890, 0000000000.
    if (new Set(n).size <= 2) continue;
    if ('0123456789'.includes(n) || '9876543210'.includes(n)) continue;

    return { ok: true, e164: `+91${n}`, national: n };
  }

  // Nothing validated — classify for the quarantine report.
  const d = s.replace(/\D/g, '');
  if (multiple)      return { ok: false, reason: 'multiple' };
  if (d.length > 10) return { ok: false, reason: 'foreign' };   // +1, +971, +44, +94, +60, +977
  if (d.length < 10) return { ok: false, reason: 'too_short' };
  return { ok: false, reason: 'invalid_prefix' };
}
```

### 4.2 Rules

- **Never drop a bad row.** Failed rows go to `import_rows_rejected` with the reason and the full original row as JSONB, surfaced as a post-import "N rows need attention" panel with inline correct-and-retry. Silent data loss is how a CRM loses trust in week two.
- **Never mutate on read.** Normalization happens once, at import. Queries join on the stored `phone_e164` only. Normalizing inside a query kills every index.
- **Foreign numbers are stored, not discarded** — flagged `is_foreign`, excluded from conversion metrics by default (they can't walk into a Bangalore store), included in raw lead exports.
- **Only the phone identifies a customer.** Names are unreliable (`—baide—`, `$indhU ℃hethaN`, `MARY JOSEPHINE 321`, `Sneh�`) and emails are shared (`customercare@deepam.com`, `deepamcustomercare@gmail.com` appear on multiple walk-in rows — staff filling in the form). Never fuzzy-match on name; it will merge two real customers and that's unrecoverable.

### 4.3 Upsert semantics

One `customers` row per `phone_e164`. On re-import, enrich rather than overwrite: fill `full_name`, `email`, `city`, `dob`, `anniversary` only where currently `NULL`, unless the incoming source has higher trust (walk-in form > Meta lead form > POS bill name). Track `updated_at` and keep the losing values in the touch's `raw` JSONB so nothing is lost.

---

## 5. Data model

### 5.1 Entity overview

```
campaigns ──< import_batches ──< lead_touches >── customers ──< walkin_submissions
                    │                                  │
                    └──< import_rows_rejected          └──< sales >── stores
                                                       │
                                                  customer_attribution (derived)
```

Design principle: **`customers` is thin and canonical; every source-specific field lives on its own table.** This is what lets you add a fifth channel later without a migration to the customer table.

### 5.2 DDL

```sql
-- ── Reference ────────────────────────────────────────────────────────────────
CREATE TABLE stores (
  id              SERIAL PRIMARY KEY,
  code            TEXT UNIQUE NOT NULL,          -- 'MG_ROAD' | 'JAYANAGAR'
  name            TEXT NOT NULL,
  voucher_prefix  TEXT UNIQUE,                   -- 'BK01-' | 'BK02-'  ← confirm mapping
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TYPE channel AS ENUM ('meta','whatsapp','walkin','google','referral','existing','other');

-- How a customer entered the business, recomputed on every import (§6.1).
CREATE TYPE lifecycle AS ENUM ('new','existing','unknown');

-- WHY the classification was assigned — lets it self-correct as history accumulates.
CREATE TYPE lifecycle_basis AS ENUM (
  'prior_purchase',   -- provable: a bill predates the campaign window       (strongest)
  'self_declared',    -- walk-in form: how_did_you_hear = 'Existing Customer'
  'no_lead_match',    -- inferred: bought, but matches no lead record        (weakest)
  'lead_matched'      -- matched a lead touch → treated as new
);

CREATE TABLE campaigns (
  id           SERIAL PRIMARY KEY,
  name         TEXT NOT NULL,                    -- 'Varamahalakshmi — Main Campaign'
  channel      channel NOT NULL,
  platform     TEXT,                             -- 'instagram' | 'whatsapp_business'
  started_on   DATE NOT NULL,                    -- REQUIRED: substitutes for missing per-lead timestamps
  ended_on     DATE,
  spend_amount NUMERIC(12,2),                    -- enables CAC / ROAS later
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (name, started_on)
);

-- ── Ingestion audit ──────────────────────────────────────────────────────────
CREATE TYPE import_status AS ENUM ('pending','parsing','preview','committed','failed','rolled_back');

CREATE TABLE import_batches (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id    INT REFERENCES campaigns(id),
  source_type    channel NOT NULL,               -- 'sales' handled via source_kind below
  source_kind    TEXT NOT NULL,                  -- 'lead' | 'sale'
  file_name      TEXT NOT NULL,
  sheet_name     TEXT,                           -- Meta workbook has 5 sheets → 5 batches
  file_url       TEXT,                           -- Vercel Blob, for re-processing
  file_hash      TEXT,                           -- sha256; warn on duplicate upload
  status         import_status NOT NULL DEFAULT 'pending',
  rows_total     INT DEFAULT 0,
  rows_ok        INT DEFAULT 0,
  rows_rejected  INT DEFAULT 0,
  rows_duplicate INT DEFAULT 0,
  uploaded_by    TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  committed_at   TIMESTAMPTZ
);

CREATE TABLE import_rows_rejected (
  id          BIGSERIAL PRIMARY KEY,
  batch_id    UUID NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  row_number  INT NOT NULL,
  raw         JSONB NOT NULL,
  error_code  TEXT NOT NULL,                     -- 'phone.foreign', 'phone.junk', 'amount.nan'
  error_msg   TEXT,
  resolved    BOOLEAN NOT NULL DEFAULT false,
  resolved_at TIMESTAMPTZ
);
CREATE INDEX ON import_rows_rejected (batch_id) WHERE NOT resolved;

-- ── Canonical customer ───────────────────────────────────────────────────────
CREATE TABLE customers (
  id                 BIGSERIAL PRIMARY KEY,
  phone_e164         TEXT UNIQUE NOT NULL,       -- '+919964767307'  ← THE join key
  phone_national     TEXT NOT NULL,              -- '9964767307'     ← for display + search
  is_foreign         BOOLEAN NOT NULL DEFAULT false,
  full_name          TEXT,
  email              TEXT,
  area               TEXT,
  city               TEXT,
  date_of_birth      DATE,
  anniversary        DATE,
  preferred_store_id INT REFERENCES stores(id),
  lifecycle          lifecycle NOT NULL DEFAULT 'unknown',       -- derived, never hand-set
  lifecycle_basis    lifecycle_basis,
  lifecycle_at       TIMESTAMPTZ,                                 -- when last recomputed
  first_seen_at      TIMESTAMPTZ NOT NULL,
  last_seen_at       TIMESTAMPTZ NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON customers (phone_national text_pattern_ops);
CREATE INDEX customers_name_trgm ON customers USING gin (full_name gin_trgm_ops);
CREATE INDEX customers_email_trgm ON customers USING gin (email gin_trgm_ops);

-- ── Lead touches: one row per (customer, campaign) contact ───────────────────
CREATE TABLE lead_touches (
  id            BIGSERIAL PRIMARY KEY,
  customer_id   BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  campaign_id   INT NOT NULL REFERENCES campaigns(id),
  batch_id      UUID NOT NULL REFERENCES import_batches(id),
  channel       channel NOT NULL,
  touched_at    TIMESTAMPTZ NOT NULL,            -- real ts if present, else campaign.started_on
  touched_at_is_estimated BOOLEAN NOT NULL DEFAULT false,
  store_pref_id INT REFERENCES stores(id),       -- Meta 'preferred_store'
  visit_date_raw TEXT,                           -- '24–26_july', '31_july_–_2_august'
  visit_slot_raw TEXT,                           -- 'slot_1_—_12pm_to_4pm_(daily)'
  raw           JSONB NOT NULL,                  -- full original row, always
  UNIQUE (customer_id, campaign_id, channel)     -- re-import is idempotent
);
CREATE INDEX ON lead_touches (customer_id);
CREATE INDEX ON lead_touches (campaign_id, channel);
CREATE INDEX ON lead_touches (touched_at);

-- ── Tele-calling follow-up (Meta sheets' 3 trailing columns) ────────────────
CREATE TYPE remark_status AS ENUM
  ('coming','not_connected','not_available','busy','not_interested','wrong_number','other','pending');

CREATE TABLE lead_followups (
  id             BIGSERIAL PRIMARY KEY,
  lead_touch_id  BIGINT NOT NULL UNIQUE REFERENCES lead_touches(id) ON DELETE CASCADE,
  call1_made     BOOLEAN,
  call2_note     TEXT,
  final_remark_raw TEXT,                          -- 'not connected ', 'coming ', 'busy'
  final_remark   remark_status NOT NULL DEFAULT 'pending',   -- normalized: trim+lower+map
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Walk-in form submissions ────────────────────────────────────────────────
CREATE TABLE walkin_submissions (
  id                BIGSERIAL PRIMARY KEY,
  submission_id     UUID UNIQUE NOT NULL,        -- from source; natural idempotency key
  customer_id       BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  batch_id          UUID NOT NULL REFERENCES import_batches(id),
  store_id          INT REFERENCES stores(id),   -- 69/820 rows blank → nullable
  how_did_you_hear  TEXT,                        -- Instagram | Walk-in | Existing Customer | WhatsApp | …
  purpose_of_visit  TEXT,                        -- Varamahalakshmi Shopping | Personal Shopping | …
  area              TEXT,
  city              TEXT,
  date_of_birth     DATE,
  anniversary       DATE,
  submitted_at      TIMESTAMPTZ NOT NULL,
  raw               JSONB NOT NULL
);
CREATE INDEX ON walkin_submissions (customer_id);
CREATE INDEX ON walkin_submissions (store_id, submitted_at);

-- ── Sales ───────────────────────────────────────────────────────────────────
CREATE TABLE sales (
  id                BIGSERIAL PRIMARY KEY,
  voucher_no        TEXT UNIQUE NOT NULL,        -- 'BK01-01941' ← natural idempotency key
  batch_id          UUID NOT NULL REFERENCES import_batches(id),
  store_id          INT NOT NULL REFERENCES stores(id),   -- derived from voucher prefix
  billed_at         TIMESTAMPTZ NOT NULL,        -- Date + Time columns combined
  customer_id       BIGINT REFERENCES customers(id),      -- NULL for the 64 phone-less bills
  customer_name_raw TEXT,
  phone_raw         TEXT,
  qty               INT,
  bill_amount       NUMERIC(12,2) NOT NULL,
  taxable_amount    NUMERIC(12,2),
  item_disc_amount  NUMERIC(12,2),
  salesman_code     TEXT,
  helper_name       TEXT,
  payments          JSONB NOT NULL DEFAULT '{}', -- {cash,card,phonepe,amex,cheque,advance,gift,credit_note}
  remarks           TEXT,
  raw               JSONB NOT NULL
);
CREATE INDEX ON sales (customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX ON sales (store_id, billed_at);
CREATE INDEX ON sales (billed_at);

-- ── Derived attribution (refreshed after every commit) ───────────────────────
CREATE MATERIALIZED VIEW customer_attribution AS
WITH first_touch AS (
  SELECT DISTINCT ON (customer_id)
         customer_id, campaign_id, channel, touched_at
  FROM   lead_touches
  ORDER  BY customer_id,
            touched_at ASC,
            CASE channel WHEN 'walkin' THEN 1 WHEN 'meta' THEN 2
                         WHEN 'whatsapp' THEN 3 ELSE 4 END
),
sale_agg AS (
  SELECT customer_id,
         COUNT(*)             AS bill_count,
         SUM(bill_amount)     AS total_sales,
         MIN(billed_at)       AS first_sale_at,
         MAX(billed_at)       AS last_sale_at
  FROM   sales WHERE customer_id IS NOT NULL
  GROUP  BY customer_id
)
SELECT c.id                                   AS customer_id,
       -- Buyers with no lead record fall into the 'existing' bucket.
       COALESCE(ft.channel, 'existing'::channel) AS primary_channel,
       ft.campaign_id                         AS primary_campaign_id,
       ft.touched_at                          AS first_touch_at,
       c.lifecycle,
       c.lifecycle_basis,
       -- Only lead-matched customers belong in an acquisition-funnel denominator.
       (ft.customer_id IS NOT NULL AND c.lifecycle <> 'existing') AS in_acquisition_funnel,
       COALESCE(sa.bill_count, 0)             AS bill_count,
       COALESCE(sa.total_sales, 0)            AS total_sales,
       sa.first_sale_at,
       sa.last_sale_at,
       (sa.customer_id IS NOT NULL)           AS converted,
       EXTRACT(DAY FROM sa.first_sale_at - ft.touched_at)::INT AS days_to_convert
FROM   customers c
LEFT   JOIN first_touch ft ON ft.customer_id = c.id
LEFT   JOIN sale_agg    sa ON sa.customer_id = c.id;

CREATE UNIQUE INDEX ON customer_attribution (customer_id);
CREATE INDEX ON customer_attribution (primary_channel, converted);
CREATE INDEX ON customer_attribution (lifecycle, in_acquisition_funnel);
-- REFRESH MATERIALIZED VIEW CONCURRENTLY customer_attribution;
```

### 5.3 Column mapping from source files

**Meta workbook** — headers vary per sheet, so match case-insensitively on normalized header text:

| Source header (any variant) | Target |
|---|---|
| `Phone_number` / `phone_number` / `phone` | → `normalizePhone()` → `customers.phone_e164` |
| `Full_name` / `full_name` | `customers.full_name` |
| `Email` / `email` | `customers.email` |
| `Preferred Store` / `preferred_store` (`jayanagar`/`mg_road`) | `lead_touches.store_pref_id` |
| `which_date_would_you_like_to_visit?` | `lead_touches.visit_date_raw` |
| `which_time_works_best_for_you?` | `lead_touches.visit_slot_raw` |
| `Call 1 Made (Yes/No)` | `lead_followups.call1_made` |
| `Call 2 ( Follow Up/ Whatsapp)` | `lead_followups.call2_note` |
| `Final Remark` | `lead_followups.final_remark_raw` → enum |

Each sheet becomes its own `campaign` + `import_batch`. `Private Preview` has no store column — leave `store_pref_id` NULL.

**WhatsApp** — `Sheet1` col A = phone, col B = constant label. No header row (row 0 is data). 3,254 of the 6,950 that normalize are duplicates; dedupe to 3,696 and record the count as `rows_duplicate`. `touched_at` = `campaign.started_on`, `touched_at_is_estimated = true`.

**Walk-ins** — direct 1:1 mapping; `submission_id` gives free idempotency; `contact_number` → phone; `created_at` → `submitted_at`; `store` (`Jayanagar`/`MG Road`) → `store_id`; blank → NULL. 820 rows → 741 customers (people submit twice; keep both submissions).

**Sales** — skip rows 0–2 (title/branch/date-range banner), header at row 3, data from row 4, **drop the final totals row** (blank voucher, `Qty=1976`, `Bill Amt=20103733`). `Voucher Prefix` → `sales.voucher_no` and prefix → `store_id`. `Date` + `Time` → `billed_at`. Payment columns (`Cash`, `CARD SALES`, `PHONE PAY`, `AMEX`, `Chq. Amt`, `AdvanceAmt`, `Gift Use Amt`, `CreditNote Use Amt`) collapse into the `payments` JSONB — they're sparse (`Gift Use Amt` is 0/847) and don't deserve columns.

---

## 6. Attribution model

301 customers appear in multiple channels, so "which channel gets credit" must be an explicit, changeable rule — not an accident of import order.

**Store every touch. Derive credit at query time.** `lead_touches` is append-only truth; `customer_attribution` is one interpretation of it and can be recomputed for free.

### 6.1 Customer lifecycle: new vs existing

A buyer who matches no lead record is classified **existing**. That covers 284 customers and ₹79,20,018 this week — 39% of gross revenue that would otherwise sit in an "unattributed" bucket nobody looks at.

Two distinct populations end up with this label, and they must stay distinguishable:

| Basis | Who | This week | Reliability |
|---|---|---|---|
| `prior_purchase` | Has a bill dated before the campaign window | 0 (no history loaded yet) | **Provable** |
| `self_declared` | Ticked "Existing Customer" on the walk-in form | 143 people, ₹27,19,335 | Trustworthy |
| `no_lead_match` | Bought, but appears in no lead list | 284 people, ₹79,20,018 | **Inferred** |

The classification is recomputed after every import, in this precedence:

```
prior_purchase  →  existing     (a bill predates the campaign window)
self_declared   →  existing     (walk-in form says so)
lead_matched    →  new          (appears in any lead source)
no_lead_match   →  existing     (bought with no lead record — your rule)
otherwise       →  unknown      (a lead who hasn't bought is neither yet)
```

**One caveat, stated once and then built around.** `no_lead_match` conflates two different people: a genuine repeat customer, and a first-time buyer who simply walked in without filling the form. With one week of data there is no way to tell them apart — the 100% conversion rate of that group is an artifact of how it's defined, not a fact about the customers. Two consequences for the build:

- Store `lifecycle_basis` alongside `lifecycle` so the weak inference is always visible and separable in any report.
- **Load historical sales as early as you can.** The moment there are bills predating the campaign, `prior_purchase` resolves most of this group provably and the classification self-corrects on the next refresh. This is the single highest-value data addition available to the system — it converts your largest revenue segment from a guess into a fact.

Until then the label is right as a default and wrong at the margin, which is fine as long as nothing downstream treats it as certain.

### Two metric families, both exposed

| Mode | Definition | Use for |
|---|---|---|
| **Any-touch (influenced)** | A customer counts toward *every* channel that touched them. Channel numbers sum to more than the total. | "Did Meta play any role?" Meta shows 85 conversions. |
| **Attributed (exclusive)** | Each customer credited to exactly one channel. Channels sum exactly to the total. | Budget allocation. Meta shows 29. |

Default the dashboard to **attributed** (so the four KPI cards reconcile), with an "Attribution: exclusive / influenced" toggle. Showing the same customer in two channel totals without warning is the fastest way to lose confidence in the dashboard.

### Exclusive-mode rule

`lifecycle = 'existing'` short-circuits everything: those customers are credited to `existing`, never to a campaign. Charging a repeat customer's ₹27L to the walk-in campaign would overstate acquisition performance by more than the campaign produced.

For everyone else, in strict precedence: **(1)** a real timestamp beats an estimated one — Meta and WhatsApp touches are stamped `campaign.started_on` and flagged `touched_at_is_estimated`, and a placeholder must not outrank a measured walk-in time; **(2)** earliest `touched_at` wins; **(3)** ties break on channel priority **walk-in > Meta > WhatsApp > other**.

Rationale: walk-in is the strongest intent signal (they're physically in the store); WhatsApp is a broadcast to an existing list and is closest to a no-op signal. Because Meta and WhatsApp lack per-lead timestamps, most ties resolve on priority — which is exactly why the priority list must be a config constant you can change and re-run, not hardcoded in a query.

Applying the existing-first rule is what moves the walk-in channel from 741 leads / ₹93.6L to 598 / ₹66.4L: 143 of its "leads" were repeat customers who told you so on the form.

### Conversion window

A sale counts as a conversion only if `billed_at >= first_touch_at` (a purchase before the campaign isn't caused by it) and within `ATTRIBUTION_WINDOW_DAYS` (default **30**) of it. Make this a settings value — a saree purchase has a long consideration cycle and you'll want to tune it. **Note:** with one week of data and estimated timestamps, ~all touches land on the campaign start date, so the window barely binds today. It matters from month two onward, so build it in now.

---

## 7. Metric definitions

Exact semantics for the headline cards. Every one respects the active date range, store filter, and campaign filter.

**The denominator rule: only customers who can be acquired belong in the acquisition funnel.** Existing customers are excluded from Total Leads and Conversion Rate, and reported in their own tile. Their revenue still counts toward Total Sales, because it's real money.

| Card | Definition | This week |
|---|---|---|
| **Total Leads** | `COUNT(DISTINCT customer_id)` in `lead_touches` where `touched_at` in range, `lifecycle <> 'existing'`, `NOT is_foreign`. Deduped across channels. | **5,723** |
| **Leads Converted** | Of those, count with ≥1 `sales` row satisfying the conversion window. | **294** |
| **Total Sales** | `SUM(bill_amount)` over all bills in range — new + existing + phone-less. Gross, so it reconciles to the POS report. | **₹2,01,03,733** |
| **Conversion Rate** | `Leads Converted / Total Leads`, one decimal. Acquisition only. | **5.1%** |

Secondary tiles: **Existing customers** (427 people · ₹1,06,39,353 · 58% of revenue), **New-customer revenue** (₹77,48,019), per-store split (MG Road / Jayanagar), average order value, **unmatched revenue** (66 phone-less bills · ₹17,16,361), `SHOWING n on this page`.

Three invariants worth asserting in a test, because breaking any of them silently produces a plausible-looking wrong number:

```
new_revenue + existing_revenue + phoneless_revenue  =  gross_revenue
sum(revenue by primary_channel)                     =  gross - phoneless   (exclusive mode)
total_leads                                          =  sum(leads by channel) - existing  (exclusive mode)
```

Reference query for the KPI row:

```sql
WITH scoped_leads AS (                       -- acquisition denominator
  SELECT DISTINCT lt.customer_id
  FROM   lead_touches lt
  JOIN   customers c ON c.id = lt.customer_id
  WHERE  NOT c.is_foreign
    AND  c.lifecycle <> 'existing'           -- ← existing customers cannot be acquired
    AND  lt.touched_at BETWEEN $1 AND $2
    AND  ($3::channel IS NULL OR lt.channel = $3)
    AND  ($4::int     IS NULL OR lt.campaign_id = $4)
),
scoped_sales AS (                            -- conversions among those leads
  SELECT s.customer_id, SUM(s.bill_amount) AS amt
  FROM   sales s
  JOIN   scoped_leads sl        ON sl.customer_id = s.customer_id
  JOIN   customer_attribution ca ON ca.customer_id = s.customer_id
  WHERE  s.billed_at BETWEEN $1 AND $2
    AND  s.billed_at >= ca.first_touch_at
    AND  s.billed_at <  ca.first_touch_at + ($5 || ' days')::INTERVAL
    AND  ($6::int IS NULL OR s.store_id = $6)
  GROUP  BY s.customer_id
),
revenue AS (                                 -- gross, split by lifecycle
  SELECT COALESCE(SUM(s.bill_amount), 0)                                    AS gross,
         COALESCE(SUM(s.bill_amount) FILTER (WHERE c.lifecycle = 'existing'), 0) AS existing_rev,
         COALESCE(SUM(s.bill_amount) FILTER (WHERE s.customer_id IS NULL), 0)    AS phoneless_rev,
         COUNT(DISTINCT s.customer_id) FILTER (WHERE c.lifecycle = 'existing')   AS existing_buyers
  FROM   sales s
  LEFT   JOIN customers c ON c.id = s.customer_id
  WHERE  s.billed_at BETWEEN $1 AND $2
    AND  ($6::int IS NULL OR s.store_id = $6)
)
SELECT (SELECT COUNT(*) FROM scoped_leads)             AS total_leads,
       (SELECT COUNT(*) FROM scoped_sales)             AS leads_converted,
       r.gross                                          AS total_sales,
       ROUND(100.0 * (SELECT COUNT(*) FROM scoped_sales)
                   / NULLIF((SELECT COUNT(*) FROM scoped_leads), 0), 1) AS conversion_rate,
       (SELECT COALESCE(SUM(amt),0) FROM scoped_sales) AS new_customer_revenue,
       r.existing_rev, r.existing_buyers, r.phoneless_rev
FROM   revenue r;
```

---

## 8. Ingestion pipeline

Import is **two-phase: preview then commit.** Never write to canonical tables on the strength of an unreviewed file.

```
Upload ──> Parse ──> Normalize ──> Stage ──> PREVIEW ──> Commit ──> Refresh MV
 .xlsx     detect     phone +       write     user        txn:       customer_
 .csv      sheets     dates +       staging   reviews     upsert     attribution
           + map      amounts       rows      counts      customers
           headers    ↓                       + rejects   + touches
                      rejects                 + sample    + sales
```

**Phase 1 — Preview (`POST /api/imports`)**
1. Hash the file; warn loudly if the same hash was committed before.
2. Detect type: sheet names + header signature (a `Voucher Prefix` column ⇒ sales; a lone phone column ⇒ WhatsApp; `submission_id` ⇒ walk-in).
3. For a multi-sheet Meta workbook, prompt for one campaign mapping per sheet.
4. Parse every row → normalize → classify `ok` / `rejected` / `duplicate`.
5. Return: counts by class, 20 sample rows, all rejects with reasons, and *"this import adds N new customers and enriches M existing"*.

**Phase 2 — Commit (`POST /api/imports/:id/commit`)**
One transaction. `INSERT … ON CONFLICT DO UPDATE` on the natural keys (`customers.phone_e164`, `lead_touches (customer_id, campaign_id, channel)`, `sales.voucher_no`, `walkin_submissions.submission_id`), so re-uploading the same file is a no-op rather than a duplicate. Then, in order:

1. **Recompute `customers.lifecycle`** for every customer touched by the batch, using the §6.1 precedence. This must run *after* both leads and sales are committed — a sales-first import would classify the whole file as existing, and a later lead import has to be able to flip those rows back to `new`. Recompute, never incrementally patch.
2. `REFRESH MATERIALIZED VIEW CONCURRENTLY customer_attribution`.

Because lifecycle is derived, importing a year of historical sales later automatically reclassifies the `no_lead_match` guesses into provable `prior_purchase` — no migration, no manual cleanup.

**Idempotency is the requirement here.** Someone *will* upload the same sheet twice — the natural keys above are what make that harmless.

**Performance:** 6,962 rows in one `INSERT … SELECT` from an unnested array — a single round trip, ~1–2 s on Neon. Do not loop row-by-row over an HTTP driver; that's 6,962 round trips and a serverless timeout.

---

## 9. API surface

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/api/imports` | Upload + parse + stage; returns preview |
| `POST` | `/api/imports/:id/commit` | Commit staged batch |
| `DELETE` | `/api/imports/:id` | Roll back a committed batch (cascade by `batch_id`) |
| `GET` | `/api/imports` | Batch history + row counts |
| `GET` | `/api/imports/:id/rejects` | Rejected rows for correction |
| `GET` | `/api/dashboard/summary` | Four KPI cards + store tiles. `?from&to&store&campaign&channel&attribution` |
| `GET` | `/api/dashboard/by-channel` | Per-channel leads / converted / CVR / revenue |
| `GET` | `/api/customers` | Paginated table. `?q&store&campaign&channel&hasSales&remark&page&pageSize&sort` |
| `GET` | `/api/customers/:phone` | Full profile: touches, submissions, bills, follow-ups |
| `PATCH` | `/api/customers/:phone` | Manual field correction (audited) |
| `GET/POST` | `/api/campaigns` | List / create campaigns |
| `GET` | `/api/export/customers.csv` | Streamed CSV of the current filter |

Dashboard reads go through Server Components hitting the DB directly; the REST routes exist for export, mutations, and any future mobile/ops client. Keep the SQL in `lib/queries/*.ts` shared by both so there is exactly one definition of each metric.

---

## 10. Dashboard UI

Modelled on your reference screenshot.

```
┌──────────────┬──────────────┬──────────────┬──────────────┬──────────────┐
│ TOTAL LEADS  │  CONVERTED   │ TOTAL SALES  │  CONV. RATE  │   SHOWING    │
│    5,723     │     294      │ ₹2,01,03,733 │    5.1%      │      25      │
│ New customer │ Leads with   │ Gross billed │ Converted /  │ On this page │
│  prospects   │  a purchase  │  this week   │  total leads │              │
│  ■ dark      │              │              │              │              │
└──────────────┴──────────────┴──────────────┴──────────────┴──────────────┘
┌───────────────────────┬───────────────────────┬──────────────────────────┐
│ NEW CUSTOMERS         │ EXISTING CUSTOMERS    │ UNMATCHED                │
│ ₹77,48,019  · 42%     │ ₹1,06,39,353 · 58%    │ ₹17,16,361 · 66 bills    │
│ 294 buyers            │ 356 buyers of 427     │ no phone captured        │
└───────────────────────┴───────────────────────┴──────────────────────────┘

Customers          [search] [store ▾] [channel ▾] [new/existing ▾] [has sales ▾] [25/page ▾]
Search, filter and review customers across all channels.
──────────────────────────────────────────────────────────────────────────────
 CUSTOMER │ STORE │ CONTACT │ PURPOSE │ SOURCE │ CAMPAIGN │ SALES │ DATE │ ▸
──────────────────────────────────────────────────────────────────────────────
 Usha       Jayanagar  9845784157  Varamahalakshmi  ◆Existing  —  ₹26,509  26 Jul  ▾
   ┌────────────────────────────────────────────────────────────────────┐
   │ AREA        CITY         DATE OF BIRTH   ANNIVERSARY               │
   │ CHANNELS    CAMPAIGNS    BILLS (2)       FOLLOW-UP                 │
   │ Walk-in +   Varamahal.   BK01-01234      Call 1: Yes               │
   │ Instagram   Main Camp.   ₹26,509 · MG    Remark: Coming            │
   │ LIFECYCLE:  Existing — self-declared on walk-in form (19 Jul)      │
   └────────────────────────────────────────────────────────────────────┘
```

Details that matter:
- Currency in Indian grouping (`₹2,01,03,733`) via `Intl.NumberFormat('en-IN')` — not `13,68,946` rendered as `1,368,946`.
- **Channel** column shows *all* touches as chips, not just the attributed one — that's the whole value of keeping `lead_touches`.
- Server-side pagination and search. Never ship all 6,150 rows to the browser.
- Empty-state and NULL handling everywhere: 69 walk-ins have no store, 535 have no city, most have no DOB. Render "Not provided" like the reference, never a blank cell or `null`.
- A **lifecycle chip** (`New` / `Existing`) on every row, with the basis on hover — an existing customer inferred from `no_lead_match` should look visibly weaker than one with a prior purchase on record. A `new/existing` filter sits in the toolbar.
- A **Data quality** panel: rejected rows, phone-less bills (66, ₹17.2 L), and existing-by-inference count (284, ₹79.2 L) shown as *"classification unverified — load sales history to confirm"*. Make the gaps visible rather than letting them quietly distort the KPIs.

---

## 11. Build phases

| Phase | Deliverable | Definition of done |
|---|---|---|
| **0. Foundation** | Next.js + Neon + Drizzle, schema migrated, stores + campaigns seeded | `SELECT` from every table; `BK01-`=MG Road / `BK02-`=Jayanagar seeded (§2.2c) |
| **1. Phone module** | `lib/phone.ts` + unit tests over every real edge case in §4 | Tests cover `p:` prefix, `91`-prefix, foreign, dual-number, junk |
| **2. Sales import** | Sales parser, preview, commit | 847 bills, ₹2,01,03,733, 650 customers, 66 flagged phone-less |
| **3. Lead imports** | Meta (5 sheets), WhatsApp, walk-in parsers | 5,866 unique lead customers; 301 multi-channel |
| **4. Lifecycle + attribution + KPIs** | Lifecycle recompute, MV, metric queries, cards | Reproduces §2.3 exactly, incl. 427 existing / ₹1,06,39,353; §7 invariants hold |
| **5. Customer table** | Server-paginated table, filters, expandable rows | Search on name/phone/email; all filters compose |
| **6. Import UI** | Upload → preview → commit → reject-correction | Same file twice = no duplicates |
| **7. Auth + polish** | Login, CSV export, data-quality panel | Deployed on Vercel with Neon prod branch |

Phases 0–4 are the real system; 5–7 are surface. Do not start 5 before 4 reconciles against the numbers in §2.3 — matching a known-good figure is your only regression test.

---

## 12. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Wrong `BK01`/`BK02` → store mapping | Every per-store number is wrong; nobody notices for months | Resolved from data (§2.2c) and stored as config, not code. Manager to confirm once. Smoke check: the store revenue split shouldn't invert week over week. |
| Phone normalization bug | Silent under-matching → understated conversion | Unit tests over real values; quarantine table; never drop rows |
| Missing Jayanagar sales export | If the file is actually MG-only, half the revenue is absent | Verify the bill count reconciles against POS totals per branch in week 1 |
| 7.6% of bills have no phone | Revenue can't be attributed to any customer | Report gross vs attributed side by side; push staff to capture phone at billing |
| **`no_lead_match` = existing is an inference** | 284 customers / ₹79.2 L (39% of revenue) labelled on the weakest available evidence; some are first-time walk-ins, not repeat customers | `lifecycle_basis` on every row; UI marks it unverified; **load historical sales to resolve it provably** |
| Existing customers leak into the acquisition denominator | Conversion rate inflates from 5.1% to 10.6% and *improves* when lead capture degrades | `lifecycle <> 'existing'` in the denominator; assert the three §7 invariants in tests |
| Estimated lead timestamps | Time-to-convert analysis is unreliable | `touched_at_is_estimated` flag; ask Meta exports to include `created_time` going forward |
| Name/email-based merging | Two real customers merged, unrecoverable | Phone only. Never fuzzy-match identity. |
| Manual weekly uploads drift | Stale dashboard | Batch history with "last import" age; consider Meta Lead Ads webhook in v2 |

---

## 13. Open questions

**Nothing here blocks starting.** Phases 0–4 can be built today; every item below is either additive or self-correcting once answered.

1. **How far back does POS sales history go, and can you export it?** The highest-value question in the document. It converts the existing-customer classification — 58% of revenue — from inference to fact, and costs one export. The system reclassifies automatically when it lands, so build now and load later.
2. Attribution window — is 30 days right for a saree purchase cycle? Defaulted to 30, config value, tune later.
3. Do you have per-campaign ad spend? It's one column away from CAC and ROAS, the metric that actually decides budget.
4. Should WhatsApp broadcast recipients count as "leads" at all? At 0.2% conversion they are 61% of the acquisition denominator (3,471 of 5,723) and pull the headline rate from 12.7% down to 5.1%. Consider a "reach vs. lead" distinction — otherwise the number looks bad for the wrong reason.
5. Do you want repeat purchases tracked as a retention metric (visit frequency, days since last purchase)? The schema already supports it — 44 of the 284 inferred-existing customers bought more than once in a single week.
6. Why does Jayanagar collect more walk-in forms (437 vs 314) but bill half the revenue (₹67.3 L vs ₹1.34 Cr)? Not a system question, but the dashboard will keep raising it.
7. How many people need access, and does anyone need read-only? Needed by Phase 7 only.

**Resolved during design, no longer open:** voucher-prefix → store mapping (§2.2c); whether the sales export covers both branches (it does); walk-in feed identity — `onboarding_submissions.xlsx`, confirmed 2026-07-29.

---

## Appendix A — Analysis reproducibility

Every figure in this document is reproduced from the real source files by an executable check:

```bash
npx tsx scripts/verify-source-data.ts
```

It runs `src/lib/phone.ts` over all four files, prints the tables below, asserts each value, and exits non-zero on any drift. **Run it after any change to the phone module** — these numbers are the regression test for the whole ingestion layer.

```
SOURCE COUNTS                      SALES
meta unique phones      1,736      bills                    847
whatsapp unique         3,696      gross              ₹2,01,03,733
walkin unique             741      bills with phone         781
union of leads          5,866      unique sale phones       650
                                   phone-less bills   66 / ₹17,16,361

ACQUISITION FUNNEL                 LIFECYCLE
total leads             5,723      existing (declared)      143
converted                 294      existing (inferred)      284
conversion rate          5.1%      existing revenue   ₹1,06,39,353  (58%)
new-customer revenue ₹77,48,019    new revenue        ₹77,48,019    (42%)
```

**Note on the original analysis.** The §2 figures were first derived with a Python script whose phone parser split on delimiters *before* trying the cell as a whole. That discarded six real Meta numbers written with an internal space or hyphen (`p:76768 20802`, `p:86602-15486`). The TypeScript implementation tries the whole cell first and recovers them, so `meta unique` moved 1,730 → 1,736, `union of leads` 5,861 → 5,866, and `total leads` 5,718 → 5,723. Revenue, conversion counts and conversion rates are unaffected — none of the six purchased. The multi-channel people count was also corrected from 313 to 301 (summing pairwise overlaps triple-counts the 6 people present in all three channels).
