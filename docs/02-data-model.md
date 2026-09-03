# 02 — Data model

Read `05-money.md` before implementing anything in §7 or §8 of this document.

## 1. Domains

```
identity        app_user, consumer_profile, partner_user
partner         partner, partner_contract, store, staff_assignment, partner_document
catalog         bag_template, listing, listing_schedule
commerce        "order", order_item, payment, payment_event, refund
fulfilment      redemption, no_show_disposition
money           financial_entry, payout_run, payout, statement, cash_liability
trust           review, quality_flag, dispute, incident, quality_hold
platform        market_config, city, feature_flag, promotion, notification_template,
                notification_log, audit_log, idempotency_key, reason_code
```

## 2. Identity — two namespaces, deliberately

`app_user` wraps `auth.users`. A **consumer** and a **partner staff member** are separate records even when the same phone number exists in both.

> Do not unify these. A partner staff member who is also a consumer creates authorisation ambiguity: which role does a JWT carry when they open the consumer app on the same device?

```
app_user            id → auth.users.id, primary_market, locale, numerals, created_at
consumer_profile    user_id, first_name, last_name?, email?, phone,
                    market, city_id, dietary_flags[], allergen_ack_at?,
                    no_show_count_90d, restriction_id?, reliability_score
partner_user        user_id, full_name, phone, is_platform_staff bool
ops_user            user_id, role ops_role, market_scope market[], created_by
```

`ops_role` ∈ `support_agent | ops_manager | finance | compliance | engineering | admin`.

## 3. Partner hierarchy

```
partner  (legal entity, contract, payout account, one market only)
  └── store  (branch: location, hours, pickup point, inventory)
        └── staff_assignment  (partner_user × store × partner_role)
```

`partner_role` ∈ `owner | manager | staff | accountant`.

Roles are **per store**. A user may be `manager` at one branch and `staff` at another. `owner` and `accountant` are effectively partner-wide and modelled as an assignment to every store with a `partner_wide` flag.

### Onboarding state machine — `partner.onboarding_status`

```
lead → applied → documents_pending → under_review
     → approved → contract_pending → contract_signed
     → store_setup → first_listing_pending → active
                   ↘ rejected     (terminal, reason mandatory)
                   ↘ suspended ⇄ active
```

Every transition writes `partner_status_history(partner_id, from, to, actor, reason_code, reason_text, at)`. Ops may move a partner backward; reason is mandatory and shown to the partner verbatim.

### Contracts are versioned and immutable

```
partner_contract  id, partner_id, version, commission_bp int,
                  payout_cadence, payout_min_minor, psp_fee_bearer,
                  chargeback_bearer, no_show_policy,
                  effective_from date, effective_to date?,
                  accepted_at, accepted_by, accepted_ip, accepted_ua,
                  document_hash text
```

**A renegotiated rate creates a new row.** Never `UPDATE commission_bp`. `app.resolve_commission(partner_id, at timestamptz)` returns the contract in force at that instant, and `order.commission_bp` + `order.contract_version_id` are stamped at creation.

`psp_fee_bearer`, `chargeback_bearer` and `no_show_policy` are contract terms, not global constants — read them from the contract version, never assume. See `13-config.md`.

### Documents

```
partner_document  id, partner_id, store_id?, doc_type, market,
                  storage_path, extracted jsonb, expires_on date?,
                  status doc_status, rejection_reason_code?, rejection_text?,
                  verified_by?, verified_at?
```

`doc_type` is a **lookup table keyed by market**, not an enum — the required set is config-driven (`market_document_requirement`), because the two markets differ and a third market must not require a migration.

`doc_status` ∈ `pending | under_review | approved | rejected | expired`.

**Expiry is enforced, not advisory.** `check_document_expiry` (see `08-jobs.md`) flags at 30 days, and on expiry of a food licence sets `store.publishing_blocked_at`. Existing orders are honoured; new listings are blocked. This is a regulatory control.

## 4. Store

```
store  id, partner_id, market, city_id, display_name, category_tags[],
       address jsonb,              -- market-shaped, see below
       location geography(point),  -- partner-dragged pin, authoritative
       geocoded_location geography(point)?,  -- starting point only
       pickup_point_en text, pickup_point_ar text,
       contact_phone, timezone text,   -- 'Asia/Kuwait' | 'Africa/Cairo'
       publishing_blocked_at?, paused_until?, pause_reason_code?,
       reliability_score numeric
```

`address` is JSONB because the two markets have different shapes:

```json
// KW
{ "governorate": "Hawalli", "area": "Salmiya", "block": "10",
  "street": "Salem Al Mubarak", "building": "12" }
// EG
{ "governorate": "Cairo", "district": "Zamalek",
  "street": "Bahgat Ali", "building": "12" }
```

Validated by a Zod schema per market (`10-types.md`). The **pin is authoritative**; the geocode is a suggestion. Pickup point free text is required in both languages — a pin on a building is insufficient in both markets.

```
store_hours     store_id, weekday 0-6, opens time, closes time, shift_index
                -- multiple rows per weekday supports split shifts
store_hours_ramadan  same shape, separate schedule
store_closure   store_id, date, reason  -- holidays
```

## 5. Catalog

### Templates make the 15-second listing possible

```
bag_template  id, partner_id, store_id?,  -- null = shared across partner
              title_en, title_ar, description_en, description_ar,
              category, value_min_minor, value_max_minor, price_minor,
              default_quantity, default_window_start time, default_window_end time,
              dietary_flags[], allergen_notes_en, allergen_notes_ar,
              image_path?, archived_at?
```

Validation on save (`app.upsert_bag_template`):
- `price_minor <= value_min_minor * market_config.max_price_fraction` (default 0.50)
- `value_max_minor >= value_min_minor`
- `price_minor` within `market_config.price_min_minor … price_max_minor`
- description non-empty in at least the market's default language
- **alcohol category rejected outright** in both markets

Templates are **archived, never deleted** — historical listings reference them.

### Listing is the concrete inventory record

```
listing  id, store_id, market, template_id?,   -- nullable for custom
         title_snapshot, description_snapshot,  -- COPIED at creation
         category, price_minor, currency,
         value_min_minor, value_max_minor,      -- snapshot
         quantity_total, quantity_remaining,
         local_date date, local_start time, local_end time,
         window_start_utc timestamptz, window_end_utc timestamptz,
         reservation_cutoff_utc timestamptz,
         status listing_status, moderation_status,
         schedule_id?, created_by, cancelled_reason_code?, cancelled_at?
```

`listing_status` ∈ `draft | active | sold_out | closed | cancelled`.

**The snapshot columns are the point.** Editing a template later must never rewrite the text a consumer already bought against.

Both the local intent (`local_date`, `local_start`, `local_end`) **and** the resolved instants are persisted. The resolution uses `store.timezone`. On DST transitions the resolved instants are what matter; the local intent is what the partner meant, and what the DST integrity job re-validates against.

#### Edit rules — enforce server-side

| Edit | Rule |
|---|---|
| Quantity increase | Always permitted while `active` |
| Quantity decrease | Only down to `quantity_total - quantity_remaining` (units sold). Below that → raise, **naming the sold count**. Never silently clamp. |
| Price change | Only while zero units sold. After the first sale, frozen. |
| Window extension (later end) | Permitted while `active`; notifies existing order holders |
| Window contraction | Only if no orders exist; otherwise requires cancellation |
| Description | Permitted; does **not** retroactively alter order snapshots |

#### Cancellation

Reason from a controlled list: `sold_through_trade | unexpected_closure | staffing | quality_concern | listed_in_error | other` (free text mandatory on `other`).

Consequences shown before confirmation: affected order count, total refund value, that consumers are notified immediately, and that it counts against reliability.

**`quality_concern` additionally inserts a `quality_flag` visible to ops.** This gives partners a safe, low-friction way to pull food they are unsure about. The alternative is that they sell it anyway.

### Schedules

```
listing_schedule  id, store_id, template_id, weekdays int[],
                  local_start time, local_end time, quantity,
                  publish_lead_minutes, active bool,
                  ramadan_affected bool, paused_at?
```

`materialise-schedules` runs daily over a rolling **14-day** horizon:
- Materialised listings are individually editable and cancellable without touching the schedule.
- A schedule pause stops future materialisation; already-materialised listings survive.
- `market_holiday(market, date, name)` suppresses materialisation, with a per-schedule override.
- **Ramadan:** schedules flagged `ramadan_affected` are suspended and the partner is prompted to author a Ramadan pair (post-iftar, pre-suhoor). Never silently publish 18:00 windows through Ramadan.
- **DST:** before each Egyptian transition, validate every future materialised listing for non-existent or ambiguous local times; alert ops **and** the partner.

## 6. Commerce

```
"order"  id, code text unique,          -- restricted alphabet, see below
         consumer_id, listing_id, store_id, partner_id, market,
         quantity int,
         unit_price_minor, subtotal_minor, service_fee_minor,
         tax_minor, total_minor, currency,
         commission_bp int,             -- STAMPED at creation
         commission_minor bigint,       -- STAMPED at creation
         contract_version_id uuid,      -- STAMPED at creation
         promotion_id?, discount_minor, discount_funded_by,
         title_snapshot, description_snapshot, window_start_utc, window_end_utc,
         payment_method, payment_status, status order_status,
         hold_expires_at?, cancelled_reason_code?,
         created_at, updated_at
```

`order_status` ∈ `held | reserved | redeemed | no_show | cancelled_consumer | cancelled_partner | refunded`.

**Order code alphabet** excludes visually ambiguous glyphs: no `0/O`, `1/I/L`, `5/S`, `8/B`. Use `23467 9ACDEFGHJKMNPQRTUVWXYZ`. Format `XXX-XX`, rendered mono. Partner-side lookup does a fuzzy match on partial input.

```
payment        id, order_id, provider, provider_ref, method,
               amount_minor, currency, status payment_status,
               psp_fee_minor?, captured_at?, settled_at?,
               raw jsonb
payment_event  id, payment_id, event_type, provider_ref, signature_valid bool,
               payload jsonb, processed_at?, processing_result
refund         id, order_id, payment_id?, amount_minor, destination,
               reason_code, requested_by, approved_by?, status, disbursed_at?
```

`payment_event` is append-only and is the audit trail for every webhook, including duplicates and replays. `provider_ref` is the idempotency anchor for reconciliation.

## 7. Fulfilment

```
redemption  id, order_id, store_id, mechanism,     -- code_shown | qr_scanned
            staff_user_id,                          -- who, from the shift selector
            client_ts timestamptz?,                 -- device time if offline-queued
            server_ts timestamptz not null,
            offline_queued bool, idempotency_key text,
            undone_at?, undone_by?
no_show_disposition  order_id, disposition, recorded_by, at
```

`disposition` ∈ `donated | sold_in_store | kept | disposed`. One tap, and it feeds both the compliance ledger and impact metrics.

**Undo window: 120 seconds**, same staff member. After that, reversal requires ops and is logged as an exception.

**Late redemption:** permitted for a configurable grace (default 30 min) after window close via `app.redeem_order_late()`, which records the grace flag, reverses the consumer's no-show count, and writes an audit row. Without this, staff redeem *a different order* to keep the peace and the ledger becomes fiction.

## 8. Money — see `05-money.md` for the entry patterns

```
financial_entry  id, transaction_id uuid, entry_type entry_type,  -- debit|credit
                 account ledger_account, amount_minor bigint, currency char(3),
                 market, partner_id?, store_id?, order_id?, payment_id?, payout_id?,
                 reference_type, reference_id,
                 effective_at timestamptz,    -- business event time
                 recorded_at timestamptz,     -- system write time
                 contract_version_id?, created_by, reason_code?
```

**Invariant, enforced by a constraint trigger:** for every `transaction_id`, `sum(debits) = sum(credits)` per currency. A daily job re-verifies globally.

```
payout_run  id, market, period_start, period_end, status,
            frozen_at?, approved_by_1?, approved_by_2?, executed_at?
payout      id, run_id, partner_id, gross_minor, netted_minor, net_minor,
            carry_in_minor, carry_out_minor, status, failure_reason?
statement   id, payout_id, partner_id, period, pdf_path, csv_path, totals jsonb
cash_liability  partner_id, balance_minor, oldest_entry_at, settlement_mode
```

`ledger_account` enum — the chart of accounts, per market and currency:

`cash_in_transit · platform_bank · partner_payable · partner_receivable · commission_revenue · psp_fees · refunds_payable · consumer_wallet_liability · promotion_expense_platform · promotion_contra_partner · vat_payable · chargeback_losses · goodwill_expense · unreconciled_suspense`

`unreconciled_suspense` **must be zero to close a period.**

## 9. Trust & safety

```
review        id, order_id, consumer_id, store_id, rating 1-5, tags[],
              body?, photo_path?, published bool, hidden_reason?
review_response  review_id, body, moderation_status, responded_by
quality_flag  id, order_id?, store_id, source,   -- consumer | partner | ops
              category, body, acknowledged_at?, acknowledged_by?,
              escalated_at?, severity
dispute       id, case_ref, order_id, consumer_id, category, severity,
              consumer_statement, photos[], partner_statement?, partner_deadline?,
              owner_ops_user?, resolution?, financial_outcome jsonb,
              opened_at, resolved_at?
incident      id, ref, market, partner_id, store_id, opened_at,
              categories[], order_refs[], consumer_reports jsonb,
              partner_response?, platform_action jsonb, resolution?,
              closed_at?, signed_off_by?, amends_incident_id?
quality_hold  id, store_id, reason_text, expected_duration,
              cancel_existing bool, placed_by, placed_at, released_at?
```

`dispute.severity` ∈ `critical | high | standard`:

| Severity | Categories | Routing |
|---|---|---|
| `critical` | suspected foodborne illness, contamination | **Immediate to Compliance. Partner is informed, never asked to triage.** SLA in hours. Automatic consideration of a quality hold. |
| `high` | safety concern, never received | Ops owner assigned, SLA in hours |
| `standard` | wrong quantity, store closed, charged incorrectly | SLA in business days |

`incident` is **immutable once `closed_at` is set.** A correction is a new row with `amends_incident_id` pointing at the original. Enforced by trigger. Linked bidirectionally to the compliance ledger rows for the implicated listings and redemptions.

## 10. Platform

```
market_config     market pk, currency, exponent, timezone, locales[],
                  numerals_default, payment_methods[], cash_enabled bool,
                  default_commission_bp, vat_applies bool, vat_bp?, vat_effective_from?,
                  invoicing_mode, regulator_name, price_min_minor, price_max_minor,
                  max_price_fraction, reservation_cap_new_user, hold_duration_minutes,
                  payout_cadence, payout_min_minor, version int, approved_by_1, approved_by_2
city              id, market, name_en, name_ar, governorate, stage,  -- waitlist|soft|live
                  centroid geography, radius_m, marketplace_hours jsonb
feature_flag      key, market?, city_id?, cohort?, enabled bool, updated_by, updated_at
promotion         id, code, market, discount_type, discount_value,
                  funded_by promotion_funder,   -- NOT NULL, no default
                  eligibility jsonb, cap_per_user, cap_total,
                  budget_cap_minor, valid_from, valid_to, stackable bool
notification_template  key, locale, title, body, deep_link,
                       reviewed_by?, reviewed_at?, published bool
notification_log  id, template_key, locale, recipient_user, order_id?,
                  channels[], results jsonb, suppressed_reason?, sent_at
audit_log         id, actor_user, actor_role, operation, target_type, target_id,
                  before jsonb?, after jsonb?, reason_code?, justification?,
                  ip inet, session_id, at
reason_code       code pk, domain, label_en, label_ar_kw, label_ar_eg,
                  requires_free_text bool
```

**`promotion.funded_by` is `NOT NULL` with no default.** A promotion without funding attribution cannot be represented in the ledger, so the schema makes it impossible to create. `funded_by` ∈ `platform | partner`, and it changes the commission base:

- `platform` → consumer pays less, partner is paid in full, commission computed on **gross**, `promotion_expense_platform` debited.
- `partner` → partner absorbs it, commission computed on the **discounted** amount, no platform expense.

**Market config changes require four eyes** (`approved_by_1`, `approved_by_2` both non-null and distinct) and bump `version`. Historic versions are retained; a rate change never restates a closed period.

## 11. Indexing notes

| Query | Index |
|---|---|
| Browse feed | `listing(market, city_id, status, window_end_utc) where status = 'active'` |
| Geo browse | GiST on `store.location` |
| Orders board | `"order"(store_id, window_start_utc, status)` |
| Code lookup | `"order"(code)` unique; `"order"(store_id, code text_pattern_ops)` for fuzzy |
| Ledger by partner/period | `financial_entry(partner_id, effective_at)`, `(transaction_id)`, `(account, market, effective_at)` |
| Reconciliation | `payment(provider, provider_ref)` unique |
| Expiry job | `partner_document(expires_on) where status = 'approved'` |
| Hold release | `"order"(hold_expires_at) where status = 'held'` |
| No-show job | `"order"(window_end_utc) where status = 'reserved'` |

Partition `financial_entry` by month once it exceeds ~50M rows. Not needed at launch; design the queries so it is possible.
