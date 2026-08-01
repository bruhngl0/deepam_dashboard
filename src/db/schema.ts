/**
 * Database schema — see SYSTEM_DESIGN.md §5 and DECISIONS.md §K.
 *
 * Design principle (D-64): `customers` is thin and canonical; every
 * source-specific field lives on its own table. Adding a fifth channel later is
 * a new table plus a parser, not a migration on the busiest table in the system.
 */

import {
  pgTable,
  pgEnum,
  serial,
  bigserial,
  integer,
  bigint,
  text,
  boolean,
  date,
  timestamp,
  numeric,
  jsonb,
  uuid,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ── Enums ────────────────────────────────────────────────────────────────────

/** Acquisition channels. `existing` is a terminal bucket, not a campaign. (D-34) */
export const channelEnum = pgEnum('channel', [
  'meta',
  'whatsapp',
  'walkin',
  'google',
  'referral',
  'existing',
  'other',
]);

/** How a customer entered the business. Derived, never hand-set. (D-39) */
export const lifecycleEnum = pgEnum('lifecycle', ['new', 'existing', 'unknown']);

/** Why a lifecycle was assigned — lets it self-correct as history lands. (D-36) */
export const lifecycleBasisEnum = pgEnum('lifecycle_basis', [
  'prior_purchase', // provable: a bill predates the campaign window  (strongest)
  'self_declared', // walk-in form: how_did_you_hear = 'Existing Customer'
  'lead_matched', // matched a lead touch → treated as new
  'no_lead_match', // inferred: bought, but matches no lead record    (weakest)
]);

export const importStatusEnum = pgEnum('import_status', [
  'pending',
  'parsing',
  'preview',
  'committed',
  'failed',
  'rolled_back',
]);

export const sourceKindEnum = pgEnum('source_kind', ['lead', 'sale']);

/** Normalized tele-calling outcome. Raw text is preserved alongside. (D-67) */
export const remarkStatusEnum = pgEnum('remark_status', [
  'coming',
  'not_connected',
  'not_available',
  'busy',
  'not_interested',
  'wrong_number',
  'other',
  'pending',
]);

// ── Reference ────────────────────────────────────────────────────────────────

/**
 * Branches. `voucherPrefix` is how a sale row is assigned to a store — the POS
 * export has no branch column, only a prefixed voucher number. (D-26, D-27)
 */
export const stores = pgTable('stores', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(), // 'MG_ROAD' | 'JAYANAGAR'
  name: text('name').notNull(),
  voucherPrefix: text('voucher_prefix').unique(), // 'BK01-' | 'BK02-'
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * A campaign is created at import time, not read from the file — none of the
 * lead exports carries a campaign name. `startedOn` is required because it is
 * the fallback timestamp for channels with no per-lead date. (D-29, D-30)
 */
export const campaigns = pgTable(
  'campaigns',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    channel: channelEnum('channel').notNull(),
    platform: text('platform'), // 'instagram' | 'whatsapp_business'
    startedOn: date('started_on').notNull(),
    endedOn: date('ended_on'),
    spendAmount: numeric('spend_amount', { precision: 12, scale: 2 }), // enables CAC/ROAS
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex('campaigns_name_started_idx').on(t.name, t.startedOn)],
);

// ── Ingestion audit ──────────────────────────────────────────────────────────

/** One row per uploaded file *or sheet* — the Meta workbook yields five. (D-07) */
export const importBatches = pgTable('import_batches', {
  id: uuid('id').primaryKey().defaultRandom(),
  campaignId: integer('campaign_id').references(() => campaigns.id),
  sourceType: channelEnum('source_type').notNull(),
  sourceKind: sourceKindEnum('source_kind').notNull(),
  fileName: text('file_name').notNull(),
  sheetName: text('sheet_name'),
  fileUrl: text('file_url'), // retained for re-processing
  fileHash: text('file_hash'), // sha256; warn on duplicate upload (D-57)
  status: importStatusEnum('status').notNull().default('pending'),
  rowsTotal: integer('rows_total').notNull().default(0),
  rowsOk: integer('rows_ok').notNull().default(0),
  rowsRejected: integer('rows_rejected').notNull().default(0),
  rowsDuplicate: integer('rows_duplicate').notNull().default(0), // D-55
  uploadedBy: text('uploaded_by'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  committedAt: timestamp('committed_at', { withTimezone: true }),
});

/** Quarantine. Rows are never dropped, only set aside for correction. (D-25, D-53) */
export const importRowsRejected = pgTable(
  'import_rows_rejected',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => importBatches.id, { onDelete: 'cascade' }),
    rowNumber: integer('row_number').notNull(),
    raw: jsonb('raw').notNull(),
    errorCode: text('error_code').notNull(), // 'phone.foreign', 'phone.junk', …
    errorMsg: text('error_msg'),
    resolved: boolean('resolved').notNull().default(false),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => [
    index('import_rejects_unresolved_idx')
      .on(t.batchId)
      .where(sql`resolved = false`),
  ],
);

// ── Canonical customer ───────────────────────────────────────────────────────

/**
 * One row per human, identified solely by normalized phone. (D-03, D-23)
 *
 * Never merge on name or email — measured names include `—baide—` and
 * `$indhU ℃hethaN`, and `customercare@deepam.com` appears on multiple rows.
 */
export const customers = pgTable(
  'customers',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    phoneE164: text('phone_e164').notNull().unique(), // '+919964767307'
    phoneNational: text('phone_national').notNull(), // '9964767307'
    isForeign: boolean('is_foreign').notNull().default(false), // D-21
    fullName: text('full_name'),
    /** Channel that supplied `fullName`; drives the D-24 trust comparison. */
    nameSource: text('name_source'),
    email: text('email'),
    area: text('area'),
    city: text('city'),
    dateOfBirth: date('date_of_birth'),
    anniversary: date('anniversary'),
    preferredStoreId: integer('preferred_store_id').references(() => stores.id),
    lifecycle: lifecycleEnum('lifecycle').notNull().default('unknown'), // D-38
    lifecycleBasis: lifecycleBasisEnum('lifecycle_basis'),
    lifecycleAt: timestamp('lifecycle_at', { withTimezone: true }),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('customers_phone_national_idx').using(
      'btree',
      t.phoneNational.op('text_pattern_ops'),
    ),
    index('customers_name_trgm_idx').using('gin', t.fullName.op('gin_trgm_ops')),
    index('customers_email_trgm_idx').using('gin', t.email.op('gin_trgm_ops')),
    index('customers_lifecycle_idx').on(t.lifecycle),
  ],
);

// ── Lead touches ─────────────────────────────────────────────────────────────

/**
 * Append-only record of every contact. This is truth; attribution is one
 * interpretation of it and is fully recomputable. (D-40)
 *
 * 301 people appear in more than one channel, so a single `source` column on
 * `customers` would be a lossy opinion baked into the schema.
 */
export const leadTouches = pgTable(
  'lead_touches',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    customerId: bigint('customer_id', { mode: 'number' })
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    campaignId: integer('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => importBatches.id),
    channel: channelEnum('channel').notNull(),
    touchedAt: timestamp('touched_at', { withTimezone: true }).notNull(),
    /** True when `touchedAt` fell back to campaign.startedOn. (D-30) */
    touchedAtIsEstimated: boolean('touched_at_is_estimated')
      .notNull()
      .default(false),
    storePrefId: integer('store_pref_id').references(() => stores.id),
    visitDateRaw: text('visit_date_raw'), // '24–26_july' — unparsed (D-31)
    visitSlotRaw: text('visit_slot_raw'), // 'slot_1_—_12pm_to_4pm_(daily)'
    raw: jsonb('raw').notNull(), // D-14
  },
  (t) => [
    // Makes re-importing the same sheet a no-op. (D-59)
    uniqueIndex('lead_touches_identity_idx').on(
      t.customerId,
      t.campaignId,
      t.channel,
    ),
    index('lead_touches_customer_idx').on(t.customerId),
    index('lead_touches_campaign_channel_idx').on(t.campaignId, t.channel),
    index('lead_touches_touched_at_idx').on(t.touchedAt),
  ],
);

/** The three tele-calling columns trailing every Meta sheet. */
export const leadFollowups = pgTable('lead_followups', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  leadTouchId: bigint('lead_touch_id', { mode: 'number' })
    .notNull()
    .unique()
    .references(() => leadTouches.id, { onDelete: 'cascade' }),
  call1Made: boolean('call1_made'),
  call2Note: text('call2_note'),
  finalRemarkRaw: text('final_remark_raw'), // 'not connected ', 'coming '
  finalRemark: remarkStatusEnum('final_remark').notNull().default('pending'),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ── Walk-in submissions ──────────────────────────────────────────────────────

/**
 * 820 submissions from 741 people — the same person may fill the form twice.
 * Both are kept; they are real events. (see §O)
 */
export const walkinSubmissions = pgTable(
  'walkin_submissions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    submissionId: uuid('submission_id').notNull().unique(), // natural key (D-59)
    customerId: bigint('customer_id', { mode: 'number' })
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => importBatches.id),
    storeId: integer('store_id').references(() => stores.id), // 69/820 blank (D-28)
    howDidYouHear: text('how_did_you_hear'), // open set — TEXT, not enum (D-66)
    purposeOfVisit: text('purpose_of_visit'),
    area: text('area'),
    city: text('city'),
    dateOfBirth: date('date_of_birth'),
    anniversary: date('anniversary'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull(),
    raw: jsonb('raw').notNull(),
  },
  (t) => [
    index('walkin_customer_idx').on(t.customerId),
    index('walkin_store_submitted_idx').on(t.storeId, t.submittedAt),
  ],
);

// ── Sales ────────────────────────────────────────────────────────────────────

/**
 * One row per bill. `customerId` is nullable: 66 of 847 bills carry no usable
 * phone and can never be attributed, but their ₹17,16,361 is still revenue. (D-51)
 */
export const sales = pgTable(
  'sales',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    voucherNo: text('voucher_no').notNull().unique(), // 'BK01-01941' (D-59)
    batchId: uuid('batch_id')
      .notNull()
      .references(() => importBatches.id),
    storeId: integer('store_id')
      .notNull()
      .references(() => stores.id), // derived from voucher prefix (D-26)
    billedAt: timestamp('billed_at', { withTimezone: true }).notNull(), // Date + Time (D-33)
    customerId: bigint('customer_id', { mode: 'number' }).references(
      () => customers.id,
    ),
    customerNameRaw: text('customer_name_raw'),
    phoneRaw: text('phone_raw'),
    qty: integer('qty'),
    billAmount: numeric('bill_amount', { precision: 12, scale: 2 }).notNull(), // D-13, D-68
    taxableAmount: numeric('taxable_amount', { precision: 12, scale: 2 }),
    itemDiscAmount: numeric('item_disc_amount', { precision: 12, scale: 2 }),
    salesmanCode: text('salesman_code'),
    helperName: text('helper_name'),
    /** {cash, card, phonepe, amex, cheque, advance, gift, creditNote} (D-12) */
    payments: jsonb('payments').notNull().default(sql`'{}'::jsonb`),
    remarks: text('remarks'),
    raw: jsonb('raw').notNull(),
  },
  (t) => [
    index('sales_customer_idx')
      .on(t.customerId)
      .where(sql`customer_id IS NOT NULL`),
    index('sales_store_billed_idx').on(t.storeId, t.billedAt),
    index('sales_billed_at_idx').on(t.billedAt),
  ],
);

// ── Settings ─────────────────────────────────────────────────────────────────

/**
 * Tunable constants (DECISIONS.md §N). Kept in the database so the four
 * settings that move the headline conversion rate between 5.1% and 12.7% can be
 * changed without a deploy — and so every published figure can name the
 * settings that produced it.
 */
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  description: text('description'),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Store = typeof stores.$inferSelect;
export type Campaign = typeof campaigns.$inferSelect;
export type ImportBatch = typeof importBatches.$inferSelect;
export type Customer = typeof customers.$inferSelect;
export type LeadTouch = typeof leadTouches.$inferSelect;
export type WalkinSubmission = typeof walkinSubmissions.$inferSelect;
export type Sale = typeof sales.$inferSelect;
