# Deepam CRM — Decision Log

**Companion to `SYSTEM_DESIGN.md`.** That document says *what* to build. This one records *every rule I decided, what evidence backed it, how confident I am, and what it costs to change my mind.*

**Date:** 2026-07-29
**Data basis:** 19–26 July 2026 (8 days), four source files
**Status:** Phases 0–5 built and verified against the live database. See [`README.md`](./README.md) for phase status.

Every decision has an ID (`D-01`…). Reference them from code comments so a future reader can find the reasoning instead of guessing at it.

**Confidence scale**

| | Meaning |
|---|---|
| **Proven** | Verified against the actual data; would need new data to overturn |
| **Strong** | Multiple independent signals agree |
| **Reasoned** | Defensible judgment, no data proves it either way |
| **Provisional** | Best available guess; expected to change |

**Reversal cost**

| | Meaning |
|---|---|
| **Free** | Config change + re-run a derivation |
| **Cheap** | Code change, no migration, re-import |
| **Costly** | Schema migration or full re-import |
| **Irreversible** | Data has been destroyed or merged; cannot be undone |

---

## Table of contents

- [A. Scope and product](#a-scope-and-product) — D-01…D-05
- [B. Reading the source files](#b-reading-the-source-files) — D-06…D-14
- [C. Identity resolution](#c-identity-resolution-phone-numbers) — D-15…D-25
- [D. Stores and branches](#d-stores-and-branches) — D-26…D-28
- [E. Campaigns and time](#e-campaigns-and-time) — D-29…D-33
- [F. Customer lifecycle](#f-customer-lifecycle-new-vs-existing) — D-34…D-39
- [G. Attribution](#g-attribution) — D-40…D-45, D-85
- [H. Metrics and denominators](#h-metrics-and-denominators) — D-46…D-52
- [I. Data quality](#i-data-quality-and-rejection) — D-53…D-57
- [J. Import mechanics](#j-import-mechanics) — D-58…D-63, D-84
- [K. Schema principles](#k-schema-principles) — D-64…D-69
- [L. Tech stack](#l-tech-stack) — D-70…D-76
- [M. UI rules](#m-ui-rules) — D-77…D-83, D-86
- [N. Constants](#n-tunable-constants)
- [O. Deliberately not done](#o-deliberately-not-done)
- [P. Assumptions that could be wrong](#p-assumptions-that-could-be-wrong)
- [Q. Evidence appendix](#q-evidence-appendix)

---

## A. Scope and product

### D-01 — The product is an attribution CRM, not a sales CRM
**Rule:** The system answers *"which channel produced which customer and how much did they spend."* It does not manage a sales pipeline, deal stages, tasks, or outbound sequences.
**Why:** That's the question you asked and the one the data supports. Every source file is a *list of people*; none contains pipeline state.
**Confidence:** Reasoned · **Reversal:** Cheap (additive)

### D-02 — Batch imports, not live integrations
**Rule:** Data arrives as uploaded `.xlsx`/`.csv` files. No Meta Lead Ads webhook, no POS API, no WhatsApp Business API in v1.
**Why:** All four feeds are already exports and the reporting cadence is weekly. A webhook adds OAuth, token refresh, retry handling, and a whole failure surface to save a manual upload nobody minds doing. Revisit when someone actually wants a live number.
**Confidence:** Reasoned · **Reversal:** Cheap — `import_batches` already models a batch with a source; a webhook just becomes another writer.

### D-03 — Phone number is the only identity key
**Rule:** Customers are joined across all four sources on the normalized phone number. Nothing else.
**Why:** It is the only field present in all four files. See D-15…D-25 for the full treatment — this is the single most consequential rule in the system.
**Confidence:** Proven · **Reversal:** Irreversible if done wrong (merged customers cannot be un-merged)

### D-04 — Weekly grain, indefinite retention
**Rule:** Every import is stamped with a batch and a campaign; nothing is ever deleted or overwritten by a later import.
**Why:** Historical comparison is the whole point. Also makes every derived figure recomputable, which D-38 depends on.
**Confidence:** Reasoned · **Reversal:** Free

### D-05 — Internal tool, small trusted user base
**Rule:** Optimize for correctness and data-quality visibility, not for scale, multi-tenancy, or public-facing polish.
**Why:** ~10k rows/week, two stores, a handful of staff users. At 52 weeks that's ~500k rows — a small Postgres for years. The hard problem here is dirty data, not throughput.
**Confidence:** Proven (measured volumes) · **Reversal:** Cheap

---

## B. Reading the source files

### D-06 — `onboarding_submissions.xlsx` is the walk-in / onboarding feed
**Rule:** Treat it as the store walk-in source.
**Why:** Originally inferred — its columns (`store`, `how_did_you_hear`, `purpose_of_visit`, `area`, `city`, `anniversary`, `submission_id`) match the guest-submissions table in the reference screenshot field-for-field. **Confirmed by the user on 2026-07-29** as the onboarding sheet missing from the original three.
**Confidence:** Proven · **Reversal:** n/a
**No figures changed on confirmation** — every number in these documents was already computed from this file.

### D-07 — Each Meta sheet is a separate campaign
**Rule:** The 5 sheets (`Main Campaign`, `CAM - 4 (25th - 27th )`, `Cam - 2 (Weekend)`, `Camp - 4`, `Private Preview`) each become one `campaigns` row and one `import_batches` row.
**Why:** They have different schemas, different date ranges, and clearly ran as distinct pushes. Collapsing them into one campaign would destroy the ability to compare them — which is the point of the tool.
**Confidence:** Strong · **Reversal:** Costly (re-import)

### D-08 — Map columns by fuzzy header match, never by position
**Rule:** Normalize each header (lowercase, strip punctuation/underscores/spaces) and match on substring. `Phone_number`, `phone_number`, and `phone` all resolve to the same field.
**Why:** Measured: the 5 Meta sheets have 7, 9, 8, 10 and 7 columns, in different orders, with different casing. `Camp - 4` has a trailing empty header. Positional parsing breaks on the second sheet.
**Confidence:** Proven · **Reversal:** Cheap

### D-09 — WhatsApp file has no header row
**Rule:** Row 0 of `Sheet1` is data. Column A = phone, column B = a constant label (`Whatsapp Campaign - Delivered - Numbers`, identical on all 6,962 rows). `Sheet2` and `Sheet3` are empty; skip them.
**Why:** Measured directly.
**Confidence:** Proven · **Reversal:** Cheap

### D-10 — Discard the WhatsApp label column
**Rule:** Column B carries no information and is not stored as a field (it survives in `lead_touches.raw`).
**Why:** Constant across every row. Campaign identity comes from the import mapping (D-29), not from the file.
**Confidence:** Proven · **Reversal:** Free

### D-11 — Sales file: skip the banner, drop the totals row
**Rule:** Rows 0–2 are the title banner (`ANANTA SILK WEAVES PRIVATE LIMITED` / `MG` / `Sales List From Dated 19/07/2026 To 26/07/2026\nBranch : MG, JAYANAGAR`). Header is row 3. Data starts row 4. **The final row is a totals row** — blank voucher, `Qty=1976`, `Bill Amt=20103733` — and must be dropped.
**Why:** Measured. Importing the totals row would double the week's revenue and create a phantom customer.
**Confidence:** Proven · **Reversal:** Cheap
**Guard:** Reject any sale row with a blank `Voucher Prefix`. That single rule catches this permanently.

### D-12 — Payment columns collapse into one JSONB field
**Rule:** `Cash`, `CARD SALES`, `PHONE PAY`, `AMEX`, `Chq. Amt`, `AdvanceAmt`, `Gift Use Amt`, `CreditNote Use Amt` → `sales.payments` JSONB. Not eight columns.
**Why:** Measured sparsity across 847 bills — Card 369, PhonePe 307, Cash 231, CreditNote 22, Amex 6, Advance 3, Cheque 1, **Gift 0**. Seven of eight are mostly empty and none is queried in any dashboard metric.
**Confidence:** Strong · **Reversal:** Costly if you later want to index payment mode — but a JSONB GIN index solves that without a migration.

### D-13 — `Bill Amt` is the revenue figure
**Rule:** `bill_amount` drives every revenue metric. `Taxable Amt` and `Item Disc Amt` are stored but not used in KPIs.
**Why:** `Bill Amt` is what the customer paid and what the totals row sums. Using taxable would understate revenue by ~5% and match no other report you have.
**Confidence:** Strong · **Reversal:** Free

### D-14 — Keep the entire original row as JSONB, always
**Rule:** Every table that ingests external data carries a `raw JSONB NOT NULL` column holding the untouched source row.
**Why:** Cheap insurance. Every parsing decision in this document could be wrong; `raw` means any of them can be re-derived without asking you for the file again. At ~10k rows/week the storage cost is irrelevant.
**Confidence:** Reasoned · **Reversal:** Free
**This is the rule that makes most other rules safely reversible.**

---

## C. Identity resolution (phone numbers)

The highest-risk area in the system. Every rule here is derived from values actually present in your files.

### D-15 — Canonical format is E.164 (`+91XXXXXXXXXX`)
**Rule:** `customers.phone_e164` is `UNIQUE NOT NULL`. `phone_national` (10 digits) is stored alongside for display and search.
**Why:** Unambiguous, sorts correctly, standard. The national copy avoids a `LIKE '%…'` scan on every search.
**Confidence:** Reasoned · **Reversal:** Costly

### D-16 — Strip the `p:` prefix
**Rule:** Leading `p:` (case-insensitive, optional trailing space) is removed before parsing.
**Why:** Meta's lead-form export prefixes **every** phone value: `p:+919964767307`, `p:9999999999`.
**Confidence:** Proven · **Reversal:** Cheap

### D-17 — Peel country and trunk prefixes, longest first
**Rule:** 12 digits starting `91` → drop 2. 13 digits starting `091` → drop 3. 11 digits starting `0` → drop 1. Then require exactly 10.
**Why:** Measured formats: Meta `+919964767307` (12 after digit-strip), WhatsApp `919900512580` (12, no `+`), walk-in and sales `9480326706` (bare 10).
**Confidence:** Proven · **Reversal:** Cheap
**Ordering matters:** check 12-digit `91` before 11-digit `0`, or `0919…` mis-parses.

### D-18 — Indian mobiles must start 6–9
**Rule:** A 10-digit number whose first digit is not 6, 7, 8 or 9 is rejected as `invalid_prefix`.
**Why:** Indian mobile numbering plan. Catches landlines and mangled values that happen to be 10 digits long.
**Confidence:** Proven (regulatory) · **Reversal:** Cheap

### D-19 — Try the cell as one number first; only then split it
**Rule:** Read the whole cell as a single number. **Only if that fails** split on `- / , ; & space`, evaluate each fragment, and return the first that validates — flagging the row for review.
**Why:** Found in the Meta data: `+919945870456-9741790033` is two complete numbers in one cell. But the same file also contains `p:76768 20802` and `p:86602-15486` — *single* numbers written with an internal space or hyphen.
**The precedence is the whole rule.** Splitting first tears those apart into invalid fragments and silently discards six real customers. The original Python analysis did exactly that, which is why the documented Meta count moved 1,730 → 1,736 once the TypeScript implementation was tested against the real values.
**Confidence:** Proven — caught by a failing test, not by inspection · **Reversal:** Cheap
**Known limitation:** in a genuine two-number cell, "first valid" is a guess. It is flagged (`hadMultiple`) rather than silently accepted, so a human can correct it.

### D-20 — Reject junk placeholders
**Rule:** Reject if the number has ≤2 distinct digits (`9999999999`, `9898989898`) or is a run of consecutive digits (`1234567890`, `9876543210`).
**Why:** `p:9999999999` is in your Meta data. It passes every structural check — 10 digits, starts with 9 — and would create a fake customer that could match a fake sale.
**Confidence:** Strong · **Reversal:** Cheap
**Risk accepted:** a real number with ≤2 distinct digits would be rejected. Vanishingly rare, and it lands in the review queue rather than disappearing.

### D-21 — Store foreign numbers, exclude them from metrics
**Rule:** Non-Indian numbers are stored with `is_foreign = true`, excluded from lead counts and conversion rates by default, included in raw exports.
**Why:** Measured in the Meta file: `+1` (US), `+971` (UAE), `+44` (UK), `+94` (Sri Lanka), `+60` (Malaysia), `+977` (Nepal).
**Rationale:** They cannot walk into a Bangalore store, so they distort the conversion denominator — but they are real people who filled a real form, so deleting them is wrong.
**Confidence:** Reasoned · **Reversal:** Free (a flag, not a filter at import)

### D-22 — Normalize once at import; never in a query
**Rule:** Queries join on the stored `phone_e164`. No `REGEXP_REPLACE` in a `WHERE` or `JOIN`.
**Why:** Function-wrapped columns can't use an index. On 6k rows nobody notices; at 500k it becomes the reason the dashboard is slow, and by then it's everywhere.
**Confidence:** Proven (standard) · **Reversal:** Cheap

### D-23 — Never match identity on name or email
**Rule:** Names and emails enrich a customer record. They never merge two records.
**Why:** Measured. Names in the data include `—baide—`, `$indhU ℃hethaN`, `MARY JOSEPHINE 321`, `Sneh` with a mojibake byte, and `aarrttee thakare`. Emails are shared: `customercare@deepam.com` and `deepamcustomercare@gmail.com` each appear on multiple walk-in rows — staff filling the form on a customer's behalf.
**Confidence:** Proven · **Reversal:** **Irreversible** — a wrong merge destroys two customer histories with no way back. This is the one rule I would not relax under any deadline.

### D-24 — Enrich-don't-overwrite on re-import, with a trust order
**Rule:** On upsert, fill `full_name`, `email`, `area`, `city`, `dob`, `anniversary` only where currently `NULL` — unless the incoming source ranks higher. Trust order: **walk-in form > Meta lead form > POS bill name**.
**Why:** The walk-in form is typed by the customer at leisure; the Meta form is typed on a phone; the POS name is typed by a cashier mid-transaction (`MARY JOSEPHINE 321`). Losing values are preserved in `raw`.
**Confidence:** Reasoned · **Reversal:** Free (recompute from `raw`)

### D-25 — Rejected rows are quarantined, never dropped
**Rule:** Every row that fails normalization goes to `import_rows_rejected` with a typed reason and its full original content, and is surfaced for inline correction.
**Why:** Measured reject volume: 26 in Meta, 12 in WhatsApp. That's small — which is exactly why silently dropping them is tempting and wrong. A CRM that quietly loses records loses trust permanently, and you'd have no way to know it happened.
**Confidence:** Reasoned · **Reversal:** Free

---

## D. Stores and branches

### D-26 — `BK01-` = MG Road, `BK02-` = Jayanagar
**Rule:** Branch is derived from the voucher prefix and stored in `stores.voucher_prefix`.
**Why:** The sales export covers both branches (`Branch : MG, JAYANAGAR`) but has **no branch column**. Derived by cross-referencing customers who declared a store on the walk-in form against the prefix they were billed on:

| | Declared MG Road | Declared Jayanagar |
|---|---|---|
| Billed `BK01-` | **146** | 6 |
| Billed `BK02-` | 0 | **214** |

Corroborated independently by Meta's `preferred_store` field (`BK01-`: 32 MG / 4 Jayanagar; `BK02-`: 32 Jayanagar / 4 MG). The two salesman-code pools are also completely disjoint, confirming the prefix→branch relationship is stable rather than incidental.
**Confidence:** Strong — two independent signals agree; still worth a manager's 30-second confirmation.
**Reversal:** Free (config row) · **If wrong:** every per-store number inverts, and nobody would notice for months. Hence the smoke check below.
**Smoke check:** the store revenue split should not invert week over week. Alert if it does.

### D-27 — Store is config data, not a code constant
**Rule:** Prefix→store mapping lives in the `stores` table.
**Why:** D-26 rests on inference. A rule that might be wrong belongs somewhere a non-engineer can fix in a minute.
**Confidence:** Reasoned · **Reversal:** Free

### D-28 — Store is nullable on walk-ins
**Rule:** `walkin_submissions.store_id` is nullable.
**Why:** Measured — 69 of 820 walk-in rows have a blank `store`. Guessing would corrupt the per-store split; rejecting would lose 8% of walk-ins.
**Confidence:** Proven · **Reversal:** Free

---

## E. Campaigns and time

### D-29 — Campaign identity comes from the import mapping, not the file
**Rule:** The uploader picks (or creates) a campaign per file/sheet. `campaigns.started_on` is **required**.
**Why:** None of the three lead files contains a campaign name or a reliable date. This is the only place that information can enter the system.
**Confidence:** Proven · **Reversal:** Free

### D-30 — Missing lead timestamps fall back to `campaign.started_on`, and say so
**Rule:** `lead_touches.touched_at` uses a real timestamp where one exists; otherwise `campaign.started_on`, with `touched_at_is_estimated = true`.
**Why:** Measured: only the walk-in file has a real per-row timestamp (`created_at`). Meta sheets have a *requested visit date* (`24–26_july`, `31_july_–_2_august`) which is a future intention, not a contact time. WhatsApp has no date at all.
**Confidence:** Proven (the gap is real); Reasoned (the fallback choice)
**Reversal:** Free · **Consequence:** time-to-convert is unreliable until Meta exports include `created_time`. The flag makes that visible rather than silently wrong.

### D-31 — Requested visit date/slot stored as raw text
**Rule:** `visit_date_raw` and `visit_slot_raw` are `TEXT`, unparsed.
**Why:** Measured values are unparseable without guessing a year and a timezone: `24–26_july`, `28–30_august`, `31_july_–_2_august`, `slot_1_—_12pm_to_4pm_(daily)`, `slot_2_—_8pm_to_12am_(weekends_only)`. Note the en-dashes and em-dashes. No metric depends on them.
**Confidence:** Reasoned · **Reversal:** Free (parse later from the stored text)

### D-32 — All timestamps are `TIMESTAMPTZ`, stored UTC
**Rule:** Store UTC, render Asia/Kolkata.
**Why:** The walk-in file already carries `+00` offsets (`2026-07-19 06:15:58.991219+00`) while the sales file has naive local times (`2026-07-19` + `11:29:36`). Mixing them without an explicit zone produces a 5h30m error — enough to move a sale across a day boundary and out of its attribution window.
**Confidence:** Proven · **Reversal:** Costly
**Sales times are local (IST) and must be converted on import.**

### D-33 — Sale timestamp combines the `Date` and `Time` columns
**Rule:** `billed_at` = `Date` + `Time`, as IST → UTC.
**Why:** They're separate columns in the export. Date alone loses same-day ordering, which matters for repeat purchases (measured: one customer with 6 bills in the week).
**Confidence:** Proven · **Reversal:** Cheap

---

## F. Customer lifecycle (new vs existing)

Your rule, formalized. This is the section with the most consequential open risk.

### D-34 — A buyer matching no lead record is classified `existing`
**Rule:** Sale present, zero `lead_touches` → `lifecycle = 'existing'`, `basis = 'no_lead_match'`.
**Why:** Your instruction. It converts 284 customers and ₹79,20,018 — 39% of gross revenue — from a dead "unattributed" bucket into a named segment.
**Confidence:** Provisional — see D-36 · **Reversal:** Free (derived, recomputed every import)

### D-35 — Self-declared existing customers are also `existing`
**Rule:** Walk-in form `how_did_you_hear = 'Existing Customer'` → `lifecycle = 'existing'`, `basis = 'self_declared'`.
**Why:** Measured: 143 unique people, ₹27,19,335. They were previously counted as walk-in *campaign leads*, which credited the campaign with ₹27L of repeat business it did not generate. This is a distinct population from D-34 — these people **do** have a lead record, they just told you they were already customers.
**Confidence:** Strong · **Reversal:** Free
**Effect:** walk-in channel drops from 741 leads / ₹93.6L to 598 / ₹66.4L. That's the correction working.

### D-36 — `no_lead_match` is explicitly labelled as the weakest evidence
**Rule:** `lifecycle_basis` is stored on every customer and surfaced in the UI. Precedence: `prior_purchase` > `self_declared` > `lead_matched` > `no_lead_match`.
**Why:** **`no_lead_match` conflates two different people:** a genuine repeat customer, and a first-time buyer who walked in without filling any form. With one week of data there is no way to distinguish them. The group's 100% conversion rate is an artifact of its definition, not a fact about the customers.
**Confidence:** Proven (the ambiguity is real) · **Reversal:** Free
**This is the largest known soft spot in the system, and it covers 39% of revenue. It is labelled, not hidden.**

### D-37 — Loading sales history resolves D-36 provably
**Rule:** A bill predating the campaign window sets `basis = 'prior_purchase'` — the only provable form of "existing."
**Why:** It's the difference between inference and fact on 58% of your revenue, and it costs one POS export.
**Confidence:** Proven · **Reversal:** n/a
**Highest-value data addition available to this system.**

### D-38 — Lifecycle is recomputed, never incrementally patched
**Rule:** After every commit, recompute `lifecycle` from scratch for all affected customers.
**Why:** Order-dependence would otherwise poison the data. Import sales first and every customer in the file is classified `existing`; a later lead import must be able to flip them back to `new`. Recomputation makes import order irrelevant — and makes D-37 automatic, with no migration.
**Confidence:** Proven (order dependence is real) · **Reversal:** Free

**Implementation note.** `prior_purchase` must require that a lead touch *exists* to be prior to. The first version compared against `COALESCE(MIN(touched_at), 'infinity')`, so with no leads loaded every bill counted as predating infinity and all 650 buyers were labelled `prior_purchase` — the strongest basis — when they were `no_lead_match`, the weakest. Caught by `scripts/verify-db.ts` immediately after the first sales import; fixed in migration `0002`. Comparing against a bare `NULL` yields `NULL`, so `EXISTS` is false and the `CASE` falls through correctly.

The lesson generalises: **a bug in this function is invisible in the row counts and silently inverts how much you trust your largest revenue segment.** It is worth asserting the basis distribution after every import, not just the totals.

### D-39 — A lead who hasn't bought is `unknown`, not `new`
**Rule:** `lifecycle` starts `unknown`; becomes `new` only on a lead match, `existing` per D-34/35/37.
**Why:** "New customer" implies a customer. Someone who filled a form and never purchased is a prospect. Keeping them distinct stops "new customers" from meaning two things in two places.
**Confidence:** Reasoned · **Reversal:** Free

---

## G. Attribution

### D-40 — Store every touch; derive credit at query time
**Rule:** `lead_touches` is append-only truth. `customer_attribution` is one interpretation and is fully recomputable.
**Why:** Measured: 301 customers appear in more than one channel (Meta∩WhatsApp 198, Meta∩walk-in 80, WhatsApp∩walk-in 35, all three 6). Any single-source-of-truth column would be a lossy opinion baked into the schema.
**Figures re-baselined by D-84** — now 298 across four channels (Meta∩WhatsApp 227, Meta∩Others 51, WhatsApp∩Others 25, Meta∩Google 1). The rule is unchanged and this is the second time it has paid for itself: the whole lead layer was rebuilt without touching a customer or a sale.
**Confidence:** Proven · **Reversal:** Free
**This is what makes every other rule in this section changeable.**

### D-41 — Two metric modes, both exposed
**Rule:** **Attributed (exclusive)** — each customer credited once, channels sum to the total. **Influenced (any-touch)** — a customer counts for every channel that touched them.
**Why:** Measured: Meta converts **85** customers any-touch, **29** exclusive. The other 56 also filled the walk-in form. Both numbers are honest; publishing only one invites the accusation that the tool is hiding the other.
**Confidence:** Reasoned · **Reversal:** Free

### D-42 — Default the dashboard to exclusive
**Rule:** Exclusive is the default; a toggle switches to influenced.
**Why:** The four headline cards must reconcile. Channel numbers that sum to more than the total, with no explanation, is the fastest way to lose confidence in a dashboard.
**Confidence:** Reasoned · **Reversal:** Free

### D-43 — `existing` short-circuits attribution
**Rule:** Customers with `lifecycle = 'existing'` are credited to `existing` and never to a campaign, regardless of touches.
**Why:** Charging a repeat customer's spend to the campaign that happened to catch them overstates acquisition performance — in this week's data, by more than the walk-in campaign actually produced.
**Confidence:** Reasoned · **Reversal:** Free

### D-44 — Exclusive rule: real evidence first, then earliest touch, then channel priority
**Rule**, in strict precedence:

1. **A real timestamp beats an estimated one.** Meta and WhatsApp carry no per-lead date, so their touches are stamped `campaign.started_on` and flagged `touched_at_is_estimated` (D-30). Walk-ins carry a real timestamp.
2. **Earliest `touched_at` wins** among comparable touches.
3. **Ties break on channel priority** — walk-in > Meta > WhatsApp > other.

**Why rule 1 exists.** The first implementation ordered on `touched_at` alone, exactly as this decision originally read. That let a placeholder 19-July stamp beat a *measured* 22-July walk-in, handing Meta 59 customers and 43 conversions that belong to the walk-in channel — walk-in conversion fell from 43.0% to 15.3%. **An estimated timestamp is not evidence that a touch came first; it is an admission that we do not know when it came.** Caught by `scripts/verify-metrics.ts`, fixed in migration `0005`. Rule 1 stops firing on its own once Meta exports include `created_time`.

**Why the priority order.** Walk-in is the strongest intent signal — the person is physically in the store. WhatsApp is a broadcast to a purchased list and is closest to a no-op (0.2% conversion).

**Campaign start dates are real information and are used.** Two customers appear in both CAM-4 (started 25 July) and the WhatsApp broadcast (started 19 July); WhatsApp correctly claims them, because that blast genuinely ran six days earlier. A pure channel-priority rule would have given them to Meta and discarded a fact we hold.
**Confidence:** Reasoned; rules 1 and 2 verified against the data · **Reversal:** Free
**Alternative rejected:** last-touch-before-sale. Needs reliable timestamps, which don't exist yet. Revisit after D-30 is fixed.
**Alternative rejected:** fractional/multi-touch credit. Defensible, but nobody can explain a 0.4-customer conversion to a store manager. Not worth it at this data volume.

### D-45 — Conversion window: 30 days, configurable
**Rule:** A sale counts as a conversion if `billed_at >= first_touch_at` and within `ATTRIBUTION_WINDOW_DAYS` (default 30).
**Why:** A purchase *before* the campaign cannot have been caused by it. The 30-day ceiling stops a campaign from claiming credit forever.
**Confidence:** Reasoned — I have no data on your consideration cycle, and a saree purchase may well run longer.
**Reversal:** Free
**Honest caveat:** with one week of data and estimated timestamps, nearly all touches land on the campaign start date, so this barely binds today. It matters from month two, so it's built in now rather than retrofitted.

### D-85 — Channel priority re-ranked for the master-sheet channel set *(2026-08-03)*
**Rule:** First-touch precedence is **Google Ads > Meta > Others > WhatsApp**, stated in migration `0006` and mirrored in `settings.channel_priority`. The ordering ends with `campaign_id` so the sort is total.
**Why the order:** `google` is a tiny, hand-verified paid list — the most specific claim to origin. `meta` is paid acquisition with per-lead identity. `other` is store-sourced with no campaign of origin recorded. `whatsapp` is a broadcast to a purchased list, the weakest claim of the four.
**Why it was forced:** D-84 dissolved the walk-in channel, so the old `CASE` still ranked `walkin` first and left `google` and `other` sharing the `ELSE` bucket. A person present in both Google Ads and Others therefore had their channel decided by whatever order the planner happened to return — a non-deterministic result inside a materialized view.
**What changed in kind, not just degree:** the master workbook carries no dates, so *every* touch is `touched_at_is_estimated` and **D-44 rule 1 can never fire**. Channel priority is no longer a tiebreak of last resort — it decides every overlap. 298 people are on more than one list (Meta∩WhatsApp 227, Meta∩Others 51, WhatsApp∩Others 25, Meta∩Google 1), so this ordering alone places 298 customers.
**Confidence:** Reasoned · **Reversal:** Free — one migration, and rule 1 resumes on its own the day any export carries a real timestamp.

---

## H. Metrics and denominators

### D-46 — Only acquirable people belong in the acquisition denominator
**Rule:** `Total Leads` excludes `lifecycle = 'existing'` and `is_foreign`.
**Why:** Including inferred-existing customers moves the headline conversion rate from **5.1% to 10.6%** — and, worse, that inflated number *rises whenever lead capture gets worse*, because more buyers fail to match a lead. A metric that improves when your process degrades is worse than no metric.
**Confidence:** Proven (measured both ways) · **Reversal:** Free
**The single most important metric decision in the document.**

### D-47 — Total Sales is gross, not attributed
**Rule:** The Total Sales card shows all bills in range: ₹2,01,03,733. New, existing, and phone-less revenue are separate tiles.
**Why:** It has to reconcile against the POS report, or the first person who checks it stops trusting the dashboard. Attributed revenue is a *breakdown*, not the headline.
**Confidence:** Reasoned · **Reversal:** Free

### D-48 — Conversion Rate = converted ÷ total leads, acquisition only
**Rule:** One decimal place. Existing customers excluded from both sides.
**Why:** Follows from D-46.
**Confidence:** Reasoned · **Reversal:** Free
**This week: 294 / 5,723 = 5.1%.**

### D-49 — Existing customers get their own tile, not a footnote
**Rule:** A first-class KPI tile: 427 people, ₹1,06,39,353, 58% of revenue.
**Why:** It's the majority of the business. Burying it under an acquisition funnel would misrepresent where the money comes from.
**Confidence:** Proven · **Reversal:** Free

### D-50 — Three invariants asserted in tests
```
new_revenue + existing_revenue + phoneless_revenue = gross_revenue
sum(revenue by primary_channel)                    = gross - phoneless   (exclusive mode)
total_leads                                        = sum(leads by channel) - existing  (exclusive mode)
```
**Why:** Every one of these can break silently and still produce a plausible-looking number. Reconciliation failures must be loud.
**Confidence:** Reasoned · **Reversal:** Free

### D-51 — Phone-less bills count as revenue, never as conversions
**Rule:** 66 bills / ₹17,16,361 have no usable phone. Included in gross; excluded from every customer-level metric; shown in the data-quality panel.
**Why:** The money is real. The attribution is impossible. Both facts must be visible.
**Confidence:** Proven · **Reversal:** Free

### D-52 — WhatsApp recipients count as leads (flagged for review)
**Rule:** All 3,471 count in the acquisition denominator.
**Why:** Consistency — they were contacted, same as any other channel.
**Confidence:** Provisional. They are 61% of the denominator at 0.2% conversion and pull the headline rate from **12.7% to 5.1%**. A "reach vs. lead" distinction is arguably more honest, since a broadcast to a purchased list isn't the same act as someone filling in a form.
**Reversal:** Free · **Open question #5 in `SYSTEM_DESIGN.md` — your call.**

---

## I. Data quality and rejection

### D-53 — Reject rows, never files
**Rule:** A file with bad rows still imports; the bad rows quarantine.
**Why:** All-or-nothing import means one malformed phone number blocks 6,949 good ones.
**Confidence:** Reasoned · **Reversal:** Cheap

### D-54 — Typed reject reasons
**Rule:** `phone.empty`, `phone.foreign`, `phone.junk`, `phone.multiple`, `phone.too_short`, `phone.invalid_prefix`, `amount.nan`, `voucher.missing`.
**Why:** "12 rows failed" is not actionable. "12 rows had foreign numbers" is a decision; "12 rows had junk numbers" is a data-entry conversation with the store.
**Confidence:** Reasoned · **Reversal:** Cheap

### D-55 — Duplicates are counted and reported, not silently collapsed
**Rule:** `import_batches.rows_duplicate` records them.
**Why:** Measured: **3,254 of the 6,950 WhatsApp rows that normalize are duplicates** — 47% of the file. Collapsing that silently hides a real problem with how the export is generated.
**Confidence:** Proven · **Reversal:** Free

### D-56 — Surface gaps in the UI rather than smoothing them over
**Rule:** A permanent data-quality panel: rejected rows, 66 phone-less bills, 284 unverified-existing classifications, 535 blank cities.
**Why:** Every one of these silently distorts a KPI. Making them visible is what separates a dashboard people trust from one they argue with.
**Confidence:** Reasoned · **Reversal:** Free

### D-57 — Warn on duplicate file upload via content hash
**Rule:** SHA-256 of the file; warn loudly if that hash was committed before.
**Why:** Someone will re-upload last week's sheet. D-59 makes it harmless, but they should still be told.
**Confidence:** Reasoned · **Reversal:** Cheap

---

## J. Import mechanics

### D-58 — Two-phase: preview, then commit
**Rule:** Parse and stage → show counts, samples and rejects → explicit commit.
**Why:** No unreviewed file should ever touch canonical tables. The preview is also where the operator catches a wrong campaign mapping, which is otherwise invisible until the numbers look strange a week later.
**Confidence:** Reasoned · **Reversal:** Cheap

### D-59 — Idempotency via natural keys
**Rule:** `customers.phone_e164` · `lead_touches (customer_id, campaign_id, channel)` · `sales.voucher_no` · `walkin_submissions.submission_id`.
**Why:** Re-importing the same file must be a no-op. `voucher_no` and `submission_id` are genuine natural keys already present in the data — free correctness.
**Confidence:** Proven · **Reversal:** Costly

### D-60 — One transaction per commit
**Rule:** All writes for a batch succeed or none do.
**Why:** A half-imported sales file gives a wrong revenue total with no indication anything went wrong.
**Confidence:** Reasoned · **Reversal:** Cheap

### D-61 — Derivations run after commit, in order
**Rule:** 1) recompute `lifecycle` (D-38), 2) `REFRESH MATERIALIZED VIEW CONCURRENTLY customer_attribution`.
**Why:** Ordering is mandatory — the MV reads `lifecycle`. `CONCURRENTLY` keeps the dashboard readable during refresh.
**Confidence:** Proven · **Reversal:** Cheap

### D-62 — Set-based inserts, never row-by-row
**Rule:** One `INSERT … SELECT` from an unnested array per table.
**Why:** 6,950 rows row-by-row over an HTTP driver is 6,950 round trips and a guaranteed serverless timeout. Set-based is one round trip, 1–2s.
**Confidence:** Proven · **Reversal:** Cheap

### D-63 — Batches are reversible
**Rule:** `DELETE FROM … WHERE batch_id = ?` cascades; then re-run derivations.
**Why:** The first few imports will get a campaign mapping wrong. Without rollback the fix is a manual SQL cleanup at exactly the moment you least want one.
**Confidence:** Reasoned · **Reversal:** Cheap
**Caveat:** rollback can't restore enrichment overwritten by D-24. `raw` (D-14) is the backstop.

### D-84 — The cleaned master workbook supersedes the per-channel exports *(2026-08-03)*
**Rule:** `scripts/import-master-sheet.ts` replaces the entire lead layer from one workbook — one sheet per channel: **Meta, WhatsApp, Google Ads, Others**. It deletes every lead touch, follow-up, walk-in submission, campaign and lead import batch, then reloads. `customers` and `sales` are never touched (§O): a customer row is the identity key `sales` points at. Orphaned customers simply stop appearing in the funnel.
**Why:** The workbook is the reviewed source — phone numbers already cleaned by hand, one file instead of four exports with four schemas. The walk-in channel does not survive it: whoever prepared the file dissolved it and redistributed its 741 people across the other four channels.
**What it costs — stated because it is a real loss, not a cosmetic change:**
- `walkin_submissions.how_did_you_hear` was the **only** evidence for the `self_declared` lifecycle basis. Dropping it makes **143 customers fall through to `lead_matched`** — people who told us to our face they were already customers are now counted as new acquisitions. Every conversion figure using the D-46 denominator is inflated accordingly. `verify-metrics.ts` asserts `self_declared = 0` so the day an export restores that evidence, the test fails loudly instead of drifting.
- The workbook carries **no dates at all**. Every touch is stamped with the campaign start and flagged `touched_at_is_estimated`, so D-44 rule 1 can never fire and time-to-convert is meaningless. This is what forced D-85.
- Follow-up outcomes (D-67) are empty: the workbook records no calls.
**Confidence:** Proven — the load ran and reconciles · **Reversal:** Expensive. Back the tables up before `--commit`; restoring the walk-in evidence means re-importing the four original exports.

---

## K. Schema principles

### D-64 — `customers` is thin and canonical
**Rule:** Identity and stable attributes only. Source-specific fields live on their own tables.
**Why:** Adding a fifth channel later becomes a new table plus a parser, not a migration on the busiest table in the system.
**Confidence:** Reasoned · **Reversal:** Costly

### D-65 — Derived data lives in a materialized view, never in a column
**Rule:** `customer_attribution` is an MV. No `primary_channel` column on `customers`.
**Why:** Everything in it depends on rules (D-44, D-45, D-38) that are expected to change. A column would need a backfill each time; an MV needs a refresh.
**Confidence:** Reasoned · **Reversal:** Free

### D-66 — Enums for closed sets, TEXT for open ones
**Rule:** `channel`, `lifecycle`, `lifecycle_basis`, `import_status`, `remark_status` are enums. `how_did_you_hear`, `purpose_of_visit`, `visit_date_raw` stay TEXT.
**Why:** Measured: `how_did_you_hear` already has 10 distinct values including `Billboard / LED` and `Apartment Advertisement`, and the form can add more without warning. An enum there means a migration every time marketing edits a dropdown.
**Confidence:** Strong · **Reversal:** Costly for enums, Free for TEXT

### D-67 — Normalize the messy free-text remarks into an enum, keep the original
**Rule:** `final_remark_raw` TEXT preserved; `final_remark` enum derived (`coming`, `not_connected`, `not_available`, `busy`, `not_interested`, `wrong_number`, `other`, `pending`).
**Why:** Measured values carry trailing spaces and inconsistent casing: `'coming '`, `'not connected '`, `'not Available '`, `'not connected / wp msg sent'`. Grouping on the raw text produces a dozen variants of the same status.
**Confidence:** Proven · **Reversal:** Free

### D-68 — Money as `NUMERIC(12,2)`, never float
**Rule:** All amounts `NUMERIC`.
**Why:** Floats don't sum exactly. Revenue that fails to reconcile by ₹0.03 destroys trust just as effectively as being wrong by ₹3 lakh.
**Confidence:** Proven · **Reversal:** Costly
**Range check:** ₹2 Cr/week fits `NUMERIC(12,2)` (max ₹99,99,99,999.99) with wide headroom.

### D-69 — Trigram indexes for search
**Rule:** `pg_trgm` GIN indexes on `full_name` and `email`; `text_pattern_ops` on `phone_national`.
**Why:** The customer table's search box is the most-used feature in a CRM. Trigram supports fuzzy matching on the misspelled names measured in D-23.
**Confidence:** Reasoned · **Reversal:** Free

---

## L. Tech stack

### D-70 — Next.js (App Router) over Cloudflare Workers
**Rule:** As stated.
**Why:** Both work. Next wins on: XLSX parsing needs Node buffers and more CPU than Workers comfortably allow (Workers' CPU ceiling turns the 6,950-row import into a chunking exercise); Server Components render the customer table straight from SQL with no client data layer; file upload and auth ergonomics are materially better.
**Confidence:** Reasoned · **Reversal:** Costly
**Choose Workers instead only if you later need sub-50ms global reads — which a two-store internal CRM does not.**

### D-71 — Neon Postgres
**Rule:** As stated.
**Why:** The product is entirely aggregation and joins — that's SQL's job. Branching lets you fork production to test a risky import. Scale-to-zero suits a tool used a few hours a day.
**Confidence:** Reasoned · **Reversal:** Costly

### D-72 — Drizzle over Prisma
**Rule:** As stated.
**Why:** You will write window functions, `FILTER` clauses, `DISTINCT ON`, and CTEs (see the §7 KPI query). Drizzle stays out of the way; Prisma pushes you toward raw escape hatches for exactly this kind of query.
**Confidence:** Reasoned · **Reversal:** Cheap (schema is plain SQL either way)

### D-73 — Node runtime for imports, not Edge
**Rule:** `export const runtime = 'nodejs'` on import routes.
**Why:** XLSX parsing needs Node buffers and more CPU headroom than Edge provides.
**Confidence:** Proven · **Reversal:** Free

### D-74 — SheetJS for parsing
**Rule:** As stated.
**Why:** Handles `.xlsx` and `.csv`, and reads the multi-sheet Meta workbook natively.
**Confidence:** Reasoned · **Reversal:** Cheap

### D-75 — Neon serverless HTTP driver
**Rule:** As stated.
**Why:** Avoids connection-pool exhaustion under serverless concurrency.
**Confidence:** Proven (standard) · **Reversal:** Free
**Caveat:** HTTP driver doesn't support multi-statement transactions — use the pooled WebSocket driver for the D-60 commit path specifically.

### D-76 — Metric SQL lives in one shared module
**Rule:** All metric queries in `lib/queries/*.ts`, used by both Server Components and REST routes.
**Why:** Two definitions of "conversion rate" that disagree by 0.3% is a bug you find three months later during a meeting.
**Confidence:** Reasoned · **Reversal:** Cheap

---

## M. UI rules

### D-77 — Indian digit grouping everywhere
**Rule:** `Intl.NumberFormat('en-IN')` → `₹2,01,03,733`, never `₹20,103,733`.
**Why:** Your reference screenshot uses it; it's what your team reads natively.
**Confidence:** Proven · **Reversal:** Free

### D-78 — Server-side pagination and search
**Rule:** Never ship the full customer set to the browser. Default 25/page.
**Why:** 6,150 rows today, and it only grows.
**Confidence:** Reasoned · **Reversal:** Cheap

### D-79 — Show all channel touches per row, not just the attributed one
**Rule:** Channel chips list every touch.
**Why:** It's the entire payoff of D-40. A row showing only "walk-in" hides that the customer also came through Instagram.
**Confidence:** Reasoned · **Reversal:** Free

### D-80 — "Not provided", never blank or `null`
**Rule:** Explicit empty states.
**Why:** Measured gaps are large — 535 of 820 walk-ins have no city, most have no DOB, 69 have no store. A blank cell reads as a bug; "Not provided" reads as a fact.
**Confidence:** Proven · **Reversal:** Free

### D-81 — Lifecycle basis visible on hover
**Rule:** The `New`/`Existing` chip exposes its basis.
**Why:** An `existing` from `no_lead_match` (D-36) is a guess and must not look identical to one from `prior_purchase`.
**Confidence:** Reasoned · **Reversal:** Free

### D-82 — Filters compose; nothing resets silently
**Rule:** Store × channel × lifecycle × has-sales × date × search all combine, and the active set stays visible.
**Why:** A filter that silently clears another is how people end up quoting a number for the wrong segment in a meeting.
**Confidence:** Reasoned · **Reversal:** Cheap

### D-83 — Dashboard scoped to Instagram and WhatsApp — ⚠️ *superseded by D-86*
**Rule (as it stood):** The dashboard reported only `meta` and `whatsapp`. Walk-in was **filtered out, not deleted**.
**Why it was filtered rather than deleted:** the walk-in form was the only evidence that 16 of the 100 matched buyers were already customers. Deleting it would have let `recompute_customer_lifecycle()` silently reclassify them as new acquisitions, inflating Instagram's converted count from 72 to 85 with no remaining trace of the error. The rows stayed; the view narrowed.
**Why it did not filter `customer_attribution.primary_channel`:** that view resolves first touch across *all* channels, so someone reached on Instagram who later filled a walk-in form was credited to walk-in (migration `0005`). Narrowing it would have silently dropped 82 Instagram and 196 WhatsApp leads. First touch was instead recomputed over the in-scope channels — a structure D-86 keeps.
**Superseded because** D-84 dissolved the walk-in channel entirely. The filter no longer excluded the thing it was written to exclude; it only hid Google Ads.

### D-86 — The dashboard reports all four master-sheet channels *(2026-08-03, reverses D-83)*
**Rule:** `SCOPED_CHANNELS = ['google', 'meta', 'other', 'whatsapp']` in `lib/queries/dashboard.ts` — the single definition of scope (D-76), consumed by the customer table too.
**Why:** D-83's exclusion target no longer exists. Keeping a two-channel scope after D-84 would have hidden Google Ads — a real paid channel — for no stated reason, which is the failure mode D-83 was itself written to prevent.
**What it costs, and why it is written down rather than smoothed over:** `other` is store-sourced and converts at **44.7%**, against 7.8% for Meta and 1.3% for WhatsApp, because it is largely people who had already bought. Including it lifts blended conversion from **3.8% to 6.2% without any campaign performing better**. The channel table, not the headline rate, is what should be read to judge acquisition; the D-46 funnel figures sit on every channel row for exactly this reason.

| Channel | Leads | Bought | Rate | Revenue |
|---|---|---|---|---|
| WhatsApp | 3,562 | 46 | 1.29% | ₹11,58,530 |
| Instagram | 1,924 | 150 | 7.80% | ₹38,55,236 |
| Others | 367 | 164 | 44.69% | ₹53,63,759 |
| Google Ads | 13 | 6 | 46.15% | ₹89,829 |
| **Total** | **5,866** | **366** | **6.24%** | **₹1,04,67,354** |

**Why it still does not read `customer_attribution`:** two deliberate differences remain. That view relabels `primary_channel` to `existing` for anyone whose lifecycle is existing (D-43), which would empty the channel rows of every lead later found to be a prior customer; and it carries the 284 buyers matching no lead record, who are not leads and do not belong in a lead denominator.
**Guarded by:** the `DASHBOARD SCOPE` section of `scripts/verify-metrics.ts`, which asserts the page's own numbers rather than the materialized view's — the two agree today only because all 284 existing customers happen to have no lead touch.
**Confidence:** Proven against the live database · **Reversal:** Free — one constant.

---

## N. Tunable constants

Everything here is config, changeable without a migration.

| Constant | Default | Set by | Effect if changed |
|---|---|---|---|
| `ATTRIBUTION_WINDOW_DAYS` | 30 | D-45 | Widens/narrows what counts as a conversion |
| `CHANNEL_PRIORITY` | `walkin > meta > whatsapp > other` | D-44 | Reallocates credit between channels |
| `EXCLUDE_FOREIGN_FROM_METRICS` | `true` | D-21 | Adds foreign leads to the denominator |
| `EXCLUDE_EXISTING_FROM_FUNNEL` | `true` | D-46 | **5.1% → 10.6% conversion rate** |
| `WHATSAPP_COUNTS_AS_LEAD` | `true` | D-52 | **5.1% → 12.7% conversion rate** |
| `DEFAULT_ATTRIBUTION_MODE` | `exclusive` | D-42 | Meta conversions 29 → 85 |
| `STORE_VOUCHER_PREFIX` | `BK01-`=MG, `BK02-`=Jayanagar | D-26 | Inverts every per-store number |
| `TIMEZONE` | `Asia/Kolkata` | D-32 | Shifts sales across day boundaries |
| `PAGE_SIZE` | 25 | D-78 | — |

**The middle four move the headline number between 5.1% and 12.7%.** Every published figure must state which settings produced it.

---

## O. Deliberately not done

Considered and rejected, with the reason — so nobody re-litigates them from scratch.

| Not done | Why |
|---|---|
| Fuzzy name/email matching | D-23. Irreversible damage on a wrong merge. |
| Fractional multi-touch attribution | Cannot be explained to a store manager; data doesn't support it. |
| Live Meta / WhatsApp / POS integrations | D-02. Weekly cadence doesn't justify the failure surface. |
| Per-item / SKU analysis | Not in the export — only `Qty` and `Bill Amt`. |
| Salesman performance reporting | Codes are present but unmapped to names; different scope. |
| Customer segmentation / RFM | Needs history. Revisit after D-37. |
| Campaign spend, CAC, ROAS | `campaigns.spend_amount` exists but is unpopulated — one column away. |
| Real-time dashboard | Weekly data. An MV refresh on import is sufficient. |
| Deleting duplicate walk-in submissions | 820 rows → 741 people; the extra submissions are real events worth keeping. |
| Parsing `visit_date_raw` | D-31. No metric depends on it. |
| Multi-tenancy / org model | One business, two stores. |
| Soft deletes on customers | Nothing should ever delete a customer. |

---

## P. Assumptions that could be wrong

Ranked by damage × likelihood.

| # | Assumption | If wrong | Likelihood | Detection |
|---|---|---|---|---|
| 1 | **`no_lead_match` ⇒ existing customer** (D-34) | 39% of revenue mis-segmented; retention overstated, acquisition understated | **Moderate** — some are genuinely first-time walk-ins | Load sales history (D-37); `prior_purchase` settles it |
| 2 | `BK01-`=MG, `BK02-`=Jayanagar (D-26) | Every per-store number inverted | Low — two independent signals agree | Manager confirms; week-over-week inversion alert |
| 3 | 30-day attribution window (D-45) | Late conversions dropped or over-credited | Moderate — saree cycles may run longer | Plot days-to-convert once timestamps are real |
| 4 | WhatsApp recipients are leads (D-52) | Headline conversion rate understated by ~2.5× | Moderate — a judgment call, not a fact | Your decision |
| 5 | Walk-in > Meta priority (D-44) | Credit shifts between the two | Moderate | Compare against influenced mode |
| 6 | One week represents normal trade | Varamahalakshmi is a festival week; ratios may not generalize | **High** | Second week of data |
| 7 | Phone is a stable identity | Shared family phones merge two shoppers | Low, unfixable | None available |

**Assumption 6 deserves emphasis:** this is festival-week data. A 44% walk-in conversion rate and ₹2 Cr in 8 days are probably not your baseline. Treat every ratio in this document as *this week's*, not *typical*, until a second week lands.

**Resolved:** walk-in feed identity (D-06) — confirmed by the user 2026-07-29, no longer an assumption.

---

## Q. Evidence appendix

Every figure quoted anywhere in these documents, with its derivation. Re-run after any change to the phone module and diff against this table.

### Source files
| File | Sheets | Data rows | Unique valid phones |
|---|---|---|---|
| `Deepam Varamahalakshmi - Leads Mastersheet.xlsx` | 5 | 2,020 | 1,736 |
| `Whatsapp Campaign Delivered Numbers.xlsx` | 1 of 3 (2 empty) | 6,962 | 3,696 |
| `onboarding_submissions.xlsx` | 1 | 820 | 741 |
| `MG, JAYANAGAR_Sales Report.xlsx` | 1 | 847 bills | 650 |

### Meta workbook, per sheet
| Sheet | Rows | Unique phones | Has visit date | Has store |
|---|---|---|---|---|
| `Main Campaign ` | 1,009 | 984 | no | yes |
| `CAM - 4 (25th - 27th )` | 180 | 178 | yes | yes |
| `Cam - 2 (Weekend)` | 102 | 100 | yes | yes |
| `Camp - 4` | 360 | 356 | yes | yes |
| `Private Preview` | 369 | 358 | date col (empty) | no |

### Sales
```
bills                847        date range   2026-07-19 → 2026-07-26 (8 days)
gross revenue        ₹2,01,03,733
BK01- (MG Road)      505 bills  ₹1,33,69,360
BK02- (Jayanagar)    342 bills  ₹67,34,373
bills with phone     781        unique phones          650
bills without phone  66         value            ₹17,16,361
bills without name   50
phones with >1 bill  105        max bills, one phone     6
payment cols nonblank: card 369, phonepe 307, cash 231, creditnote 22,
                       amex 6, advance 3, cheque 1, gift 0
```

### Lead overlap
```
Meta ∩ WhatsApp   198      union of all leads      5,866
Meta ∩ walk-in     80      multi-channel people      301
WhatsApp ∩ walk-in 35      sale phones w/ a lead     366
all three           6      sale phones, no lead      284
```

### Attribution (exclusive, existing-first)
| Channel | People | Buyers | CVR | Revenue |
|---|---|---|---|---|
| Meta | 1,654 | 29 | 1.8% | ₹8,49,449 |
| WhatsApp | 3,471 | 8 | 0.2% | ₹2,54,786 |
| Walk-in | 598 | 257 | 43.0% | ₹66,43,784 |
| Existing — declared | 143 | 72 | 50.3% | ₹27,19,335 |
| Existing — inferred | 284 | 284 | 100%* | ₹79,20,018 |
| **Total** | **6,150** | **650** | — | **₹1,83,87,372** |
| Phone-less bills | — | 66 bills | — | ₹17,16,361 |
| **Gross** | | **847 bills** | | **₹2,01,03,733** |

\* 100% by construction — see D-36.

### Headline funnel
```
NEW (acquisition)      5,723 leads →   294 buyers →  5.1%  →  ₹77,48,019  (42%)
EXISTING (retention)     427 people →  356 buyers → 83.4%  → ₹1,06,39,353  (58%)
```

### Walk-in self-reported source (unique people)
| how_did_you_hear | People | Buyers | CVR | Revenue |
|---|---|---|---|---|
| Instagram | 205 | 77 | 37.6% | ₹18,28,302 |
| Walk-in | 171 | 85 | 49.7% | ₹17,89,941 |
| Existing Customer | 143 | 72 | 50.3% | ₹27,19,335 |
| WhatsApp | 118 | 58 | 49.2% | ₹15,35,714 |
| Other | 53 | 24 | 45.3% | ₹10,88,308 |
| Friend / Family | 50 | 18 | 36.0% | ₹4,88,658 |
| Google Search | 13 | 6 | 46.2% | ₹89,829 |
| Facebook | 9 | 7 | 77.8% | ₹3,59,302 |
| Billboard / LED | 5 | 3 | 60.0% | ₹94,594 |
| Apartment Advertisement | 2 | 1 | 50.0% | ₹917 |

**Note the tension:** 205 walk-in visitors say Instagram brought them, but only 80 phones appear in both the Meta exports and the walk-in file. Self-reported and tracked source disagree substantially. The schema stores both and picks neither.

### Walk-in distributions
```
store:    Jayanagar 437 · MG Road 314 · blank 69
city:     blank 535 · Bengaluru 196 · Bangalore 37 · Mumbai 5 · Delhi 4 · other 43
purpose:  Varamahalakshmi 343 · Personal 253 · Festive 83 · Wedding 70 ·
          Other 43 · Bridal 12 · Gift 11 · Browsing 5
```

### Data quality
```
Meta rejects        26   foreign, dual-number, junk
WhatsApp rejects    12   all foreign (+94 +60 +977 +44)
WhatsApp duplicates 3,254 of 6,950 valid (47%)
walk-in dupes       820 submissions → 741 people
foreign prefixes    +1 (US) +971 (UAE) +44 (UK) +94 (LK) +60 (MY) +977 (NP)
```

### Prefix→store derivation (D-26)
```
                Declared MG Road   Declared Jayanagar
BK01-                       146                     6
BK02-                         0                   214

Meta preferred_store corroboration:
BK01-   mg_road 32   jayanagar  4
BK02-   mg_road  4   jayanagar 32
```

---

## Reproducing this analysis

Every figure above is asserted by an executable check:

```bash
npx tsx scripts/verify-source-data.ts
```

It runs `src/lib/phone.ts` over the four real source files, prints each table in this appendix, compares every value against the expected figure, and exits non-zero on any drift. **Run it after any change to the phone module** — this is the regression test for the entire ingestion layer.

**The four that must hold for 19–26 July 2026:**

```
847 bills   ·   ₹2,01,03,733 gross   ·   650 unique sale phones   ·   66 phone-less bills
```

If those four reconcile, the hardest part of the pipeline is provably correct.

### Correction applied 2026-07-29

The §Q figures were first derived with a Python script whose phone parser split on delimiters *before* trying the cell as a whole — the bug described in D-19. It discarded six real Meta numbers written with an internal space or hyphen. The TypeScript implementation, driven by a failing test, recovers them:

| Figure | Was | Now |
|---|---|---|
| meta unique phones | 1,730 | **1,736** |
| whatsapp rows (total, incl. 12 rejected) | 6,950 | **6,962** |
| union of all leads | 5,861 | **5,866** |
| Meta channel (exclusive) | 1,650 | **1,656** |
| WhatsApp channel (exclusive) | 3,470 | **3,469** |
| total acquisition leads | 5,718 | **5,723** |
| multi-channel people | 313 | **301** |

Revenue, buyer counts and every conversion rate are unchanged — none of the six recovered customers purchased. The multi-channel figure was a separate arithmetic error: summing the three pairwise overlaps triple-counts the 6 people present in all three channels (198 + 80 + 35 − 2×6 = 301).

### Correction applied after the first full load

Building the real attribution surfaced two flaws that the offline analysis could not have found, because the analysis had no timestamps and no campaign dates:

| Figure | Was | Now | Why |
|---|---|---|---|
| Meta channel (exclusive) | 1,656 | **1,654** | Two customers are in CAM-4 (started 25 Jul) *and* the WhatsApp broadcast (started 19 Jul). The blast genuinely ran first, so WhatsApp claims them. The original analysis used pure channel priority and ignored campaign dates it already held. Neither converted, so no revenue moved. |
| WhatsApp channel (exclusive) | 3,469 | **3,471** | Same two customers. |

Two implementation bugs were also found and fixed, neither visible in row counts:

- **`prior_purchase` compared against the customer's own first touch** rather than the campaign window, so a customer who bought at 10:00 and was onboarded at 14:00 the same day looked like a pre-existing relationship. 188 customers and ₹48,70,785 were wrongly pulled out of the acquisition funnel. Fixed in `0004` — see D-36.
- **Estimated timestamps outranked real ones** in first-touch ordering, moving 59 customers and 43 conversions from walk-in to Meta and cutting walk-in conversion from 43.0% to 15.3%. Fixed in `0005` — see D-44.

Every headline KPI in §2.3 reconciles exactly against the live database. Run `npx tsx scripts/verify-metrics.ts` to confirm.

### Re-baselined by the master-sheet reload, 2026-08-03

**Everything above this heading describes the four per-channel exports, which no longer load the database.** D-84 replaced them with the cleaned master workbook. The figures are kept as written because they are the evidence the earlier decisions were made on — but do not quote them as current. `scripts/verify-metrics.ts` is the live baseline and is the only figure set that is maintained.

Sales are untouched, so the hardest reconciliation still holds exactly:

```
847 bills   ·   ₹2,01,03,733 gross   ·   650 unique sale phones   ·   66 phone-less bills
```

What moved, and why:

| Figure | Per-channel exports | Master sheet | Why |
|---|---|---|---|
| union of all leads | 5,866 | **5,866** | unchanged by coincidence, not by construction — the membership differs |
| multi-channel people | 301 | **298** | walk-in dissolved; Others introduced |
| Meta ∩ WhatsApp | 198 | **227** | the workbook's own dedupe compared raw strings, so more overlap survives normalization |
| channels present | meta, whatsapp, walkin | **google, meta, other, whatsapp** | D-84 |
| `self_declared` existing | 143 | **0** | walk-in form gone — the only source of that basis (D-84) |
| `no_lead_match` existing | 284 | **284** | unchanged; derived from `sales`, which was not touched |
| touches with a real date | walk-in only | **none** | the workbook carries no dates, so D-44 rule 1 never fires (D-85) |
| follow-up outcomes | populated | **empty** | the workbook records no calls |

Attribution after the reload, and the dashboard scope that reports it (D-86), are tabulated under D-86. The one figure worth repeating here: blended conversion reads **6.24%**, up from 3.8% on the two digital channels alone, entirely because `other` is store-sourced and converts at 44.7%. No campaign improved.
