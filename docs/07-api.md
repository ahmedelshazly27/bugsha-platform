# 07 — API

Three call styles. Prefer the leftmost that works.

| Style | Use for | Auth |
|---|---|---|
| **Direct select** under RLS | Reads with a stable shape | User JWT |
| **RPC** — `supabase.rpc('app.…')` | Every mutation; reads needing computation | User JWT, re-checked in the function |
| **Edge Function** | Outbound I/O, webhooks, file generation | User JWT, provider signature, or cron secret |

`07-openapi.yaml` is the machine-readable contract for the RPC and Edge surface. It is generated from this document — keep them in step.

## Conventions

- Every mutation takes `p_idempotency text`. The client generates a UUIDv4 and **reuses it across retries**.
- Every mutation returns the **full resulting record** so no follow-up read is needed.
- Errors raise a Postgres exception with a `BGxxx` errcode and a message **key**, resolved to copy by the client from `copy/errors.json`. Never return a raw English string to a user.
- Every privileged mutation takes `p_reason_code text` where a controlled reason exists, and writes an `audit_log` row.

### Error codes

| Code | Meaning | HTTP mapping |
|---|---|---|
| `BG001` | Ledger mutation attempted | 500 |
| `BG002` | Unbalanced transaction | 500 |
| `BG003` | Accounting period locked | 409 |
| `BG004` | Closed incident edit | 409 |
| `BG100` | Not authorised | 403 |
| `BG101` | Idempotency conflict — same key, different payload | 409 |
| `BG110` | Listing unavailable / sold out | 409 |
| `BG111` | Window not open | 409 |
| `BG112` | Window closed, past grace | 409 |
| `BG113` | Reservation cap reached | 409 |
| `BG114` | Quantity below units sold | 409 |
| `BG115` | Price frozen after first sale | 409 |
| `BG116` | Cancellation cutoff passed | 409 |
| `BG117` | Publishing blocked — document expired | 409 |
| `BG118` | Store paused | 409 |
| `BG120` | Already redeemed → **returns 200 with the original record**, never an error surfaced to staff |
| `BG122` | Partner code required / not live (used, expired, withdrawn) | 409 |
| `BG123` | Partner code issued for another market | 409 |
| `BG124` | Partner request or code not found | 404 |
| `BG125` | A code was already issued for this request | 409 |
| `BG126` | Code already redeemed — revoke refused, suspend the partner instead | 409 |
| `BG127` | Request was declined | 409 |
| `BG128` | Code no longer live — resend refused | 409 |
| `BG130` | Four-eyes required | 428 |
| `BG131` | Re-auth required for money operation | 428 |
| `BG140` | Payment status unresolved — retry unavailable | 409 |
| `BG150` | Tax configuration undecided for market | 500 |

`BG120` is listed for completeness but **must never reach a staff member as an error**. `app.redeem_order` returns success with the original redemption. See `12-test-plan.md §13-5`.

---

## Consumer

### Reads

```
select * from v_browse_listing
  where market = :m and city_id = :city
  order by <sort>            -- recommended | distance | price | discount | soonest | rating

-- geo browse
select * from app.browse_nearby(:lat, :lng, :radius_m, :filters jsonb)

select * from app.listing_detail(:listing_id)      -- + store, reviews, allergen, policy
select * from app.store_profile(:store_id)
select * from app.search_listings(:query, :market, :city)  -- diacritic + hamza insensitive
select * from "order" where consumer_id = auth.uid()
select * from app.order_detail(:order_id)          -- + payment, redemption, refund timeline
select * from app.my_impact()                      -- money saved, bags, stores, kg
select * from app.wallet_balance()
```

`app.search_listings` normalises Arabic: strips diacritics, unifies hamza forms (`أ إ آ ا`), `ى/ي`, `ة/ه`. Implement with a generated `search_normalised` column + `pg_trgm`, not at query time.

### Mutations

| Function | Notes |
|---|---|
| `app.set_locale(locale, numerals)` | |
| `app.set_market(market, city_id, p_confirm)` | Requires confirmation; payment methods and wallet are per market |
| `app.complete_profile(first_name, …)` | Only first name required |
| `app.set_dietary(flags[], allergen_ack)` | `allergen_ack` mandatory when an allergy flag is selected |
| `app.hold_listing(listing_id, quantity, p_idempotency)` | Decrements stock, sets `hold_expires_at`. Enforces caps → `BG113`. Returns the order in `held`. |
| `app.apply_promotion(order_id, code)` | Resolves eligibility, caps, budget; sets `discount_funded_by` from the promotion |
| `app.confirm_order(order_id, payment_ref, p_idempotency)` | **Idempotent on `provider_ref`.** Posts capture entries, order → `reserved`. |
| `app.reserve_cash_order(order_id, p_idempotency)` | Egypt only. No payment row, no entries. |
| `app.release_hold(order_id)` | Consumer abandons checkout |
| `app.cancel_order(order_id, reason_code)` | Enforces the 2 h cutoff → `BG116`. Posts refund entries. |
| `app.request_refund(order_id, amount, destination, reason_code)` | |
| `app.submit_review(order_id, rating, tags[], body, photo)` | Redeemed orders only (rule 9) |
| `app.open_dispute(order_id, category, statement, photos[], illness_detail?)` | `illness_detail` present ⇒ severity `critical`, routes to Compliance, partner not asked to triage |
| `app.request_deletion()` | Starts the statutory clock; blocked by pending orders |

### Edge Functions

`create-payment` · `confirm-payment` · `resend-otp` · `generate-document` (receipt)

---

## Partner

### Reads

```
select * from app.today(:store_id)            -- S-P-010: next window, listings, gross, alerts
select * from app.orders_board(:store_id)     -- realtime; current + next window
select * from app.lookup_order(:store_id, :fragment)   -- fuzzy on code or name
select * from app.listings(:store_id, :status, :from, :to)
select * from app.templates(:partner_id)
select * from app.schedules(:store_id)
select * from app.end_of_day(:store_id, :date)
select * from app.analytics_summary(:partner_id, :from, :to, :store_id?)
select * from app.analytics_insights(:partner_id)      -- each insight cites its evidence
select * from app.reliability(:partner_id)             -- with component breakdown
select * from app.payouts(:partner_id)                 -- owner | accountant only
select * from app.payout_detail(:payout_id)            -- expandable to constituent orders
select * from app.cash_liability(:partner_id)          -- Egypt
select * from app.compliance_ledger(:store_id, :from, :to)
```

`app.orders_board` is also a Realtime subscription target:

```ts
supabase.channel(`store:${storeId}:orders`)
  .on('postgres_changes',
      { event: '*', schema: 'public', table: 'order', filter: `store_id=eq.${storeId}` },
      onChange)
```

Contract: a new reservation is visible within **2 s p95**.

### Mutations

| Function | Role | Notes |
|---|---|---|
| `app.check_partner_code(code)` | anon | `{status: ok|invalid|expired|redeemed|revoked, market, legal_name, trading_name}` — the "Enter your partner code" screen; rate-limit at the edge |
| `app.submit_application(code, payload)` | signed in | **Requires a live partner code** (`BG122`, `BG123`); redeems it, creates the partner in `applied`, makes the caller owner. The code-less signature no longer exists |
| `app.my_partners()` | signed in | Partners the caller belongs to partner-wide, with `store_count` — non-empty for an applicant mid-onboarding while `my_stores_detail()` is still empty |
| `app.ops_partner_requests(status?, market?)` · `ops_partner_codes(market?)` | ops | The request queue and the codes, market-scoped |
| `app.ops_issue_partner_code(request, days=14, reason?)` | ops_manager, admin | Single-use `BG-XXXX-XXXX`; **the database emails it** (trigger → `partner-code-email`), `emailed_at` / `email_error` on the row |
| `app.ops_decline_partner_request(request, reason_code, text?)` · `ops_revoke_partner_code(code, reason)` · `ops_resend_partner_code(code)` | ops_manager, admin | Audited; revoking returns the request to `contacted` |
| `app.upload_document(...)` | owner | Storage path + metadata |
| `app.accept_contract(contract_id, ip, ua)` | owner | Records timestamp, IP, device, document hash |
| `app.upsert_store(...)` | owner, manager | Pin authoritative; pickup point required in both languages |
| `app.set_hours(store_id, rows[], is_ramadan)` | owner, manager | Split shifts supported |
| `app.pause_store(store_id, reason_code, until)` | owner, manager | Blocks new listings and reservations. **Does not cancel existing orders** — states so. |
| `app.upsert_bag_template(...)` | owner, manager | Price ≤ 50% of min value; alcohol rejected |
| `app.archive_template(id)` | owner, manager | Never deletes |
| `app.publish_listing(template_id, quantity, local_date, start, end, p_idempotency)` | owner, manager, staff | **The 15-second path.** One call. |
| `app.publish_listing_bulk(template_id, store_ids[], …)` | owner | Excludes publishing-blocked stores and says why |
| `app.update_listing(listing_id, quantity?, price?, end?)` | owner, manager; **staff: quantity only** | `BG114` names the sold count; `BG115` on frozen price |
| `app.cancel_listing(listing_id, reason_code, reason_text)` | owner, manager | Refunds affected orders; `quality_concern` also writes a `quality_flag` |
| `app.upsert_schedule(...)` / `app.pause_schedule(id)` | owner, manager | |
| `app.set_active_shift(store_id, staff_user_id)` | any | Attribution without re-auth |
| `app.redeem_order(order_id, mechanism, p_idempotency, client_ts?, staff_user?)` | owner, manager, staff | **Idempotent. Already-redeemed returns success with the original.** |
| `app.redeem_order_late(order_id, …)` | owner, manager, staff | Within grace; reverses the consumer's no-show |
| `app.undo_redemption(order_id)` | same staff member | 120 s window |
| `app.collect_cash(order_id, collected_minor)` | owner, manager, staff | Commission on what was collected |
| `app.mark_no_show(order_id, disposition)` | owner, manager | After close only |
| `app.submit_cash_reconciliation(store_id, date, reported_minor, note)` | owner, manager | Note mandatory above threshold |
| `app.respond_to_review(review_id, body)` | owner, manager | One reply; moderated before publication |
| `app.acknowledge_flag(flag_id, finding, action_text)` | owner, manager | Required within the deadline |
| `app.invite_staff(store_id, phone, role)` | owner; **manager: `staff` only** | |
| `app.revoke_staff(assignment_id)` | owner, manager | Immediate; terminates sessions; **queued offline redemptions remain valid** |
| `app.create_api_key(label, scopes[], store_ids[])` | owner | Returns the key **once** |

### Edge Functions

`generate-document` (statement PDF+CSV, compliance export) · `partner-api-gateway` (external key auth) · `dispatch-partner-webhook`

---

## Ops — `/v1/ops/`

Every endpoint audited. Every mutation reason-coded. Nothing edits a record directly.

### Partner lifecycle
```
app.ops_partners(filters)              app.ops_partner_detail(id)
app.ops_approve_partner(id, reason)    app.ops_reject_partner(id, reason_code, text)
app.ops_suspend_partner(id, reason_code, until, honour_existing)   -- four eyes
app.ops_reinstate_partner(id, reason)
app.ops_set_commission(id, bp, effective_from, reason)  -- NEW CONTRACT VERSION, four eyes
app.ops_override_reliability(id, score, justification)
app.ops_verify_document(doc_id, approve, reason_code, text)        -- text sent verbatim
app.ops_partner_health()               app.ops_onboarding_funnel(from, to)
```

### Marketplace
```
app.ops_live_dashboard(market)         app.ops_supply_demand(market, from, to)
app.ops_orders(filters)                app.ops_order_detail(id)
app.ops_force_redeem(order_id, reason_code, justification)
app.ops_force_cancel(order_id, reason_code, cost_bearer, justification)
app.ops_reverse_redemption(order_id, reason_code, justification)
app.ops_reissue_code(order_id, reason_code)
app.ops_reconcile_payment(payment_id, provider_ref, reason_code)
app.ops_extend_window(order_id, new_end, reason_code)
app.ops_moderation_queue()             app.ops_moderate_listing(id, action, reason, edits?)
app.ops_users(filters)                 app.ops_user_detail(id)
app.ops_issue_credit(user_id, amount_minor, reason_code)   -- goodwill by default
app.ops_restrict_user(user_id, reason_code, until)
```

`app.ops_force_cancel` takes `cost_bearer` explicitly (`platform | partner`) and **defaults the UI to `platform`** whenever the reason code indicates a platform failure. See `05-money.md §3.7`.

### Disputes & safety
```
app.ops_disputes(filters)              app.ops_assign_dispute(id, ops_user)
app.ops_resolve_dispute(id, resolution, financial_outcome)
app.ops_incidents(filters)             app.ops_open_incident(payload)
app.ops_close_incident(id, resolution, sign_off)     -- immutable thereafter
app.ops_amend_incident(id, amendment)                -- new row, references original
app.ops_place_quality_hold(store_id, reason, duration, cancel_existing)
app.ops_release_quality_hold(id)
```

### Money — Finance
```
app.ops_ledger(filters)                app.ops_ledger_transaction(txn_id)
app.ops_balance_check(market)
app.ops_post_adjustment(payload, reason_code, justification)   -- four eyes above threshold
app.ops_payout_runs(market)            app.ops_create_payout_run(market, period)
app.ops_payout_run_detail(id)          app.ops_approve_payout_run(id)  -- four eyes + re-auth
app.ops_reconciliation(kind, market, from, to)
app.ops_resolve_exception(id, resolution, reason_code)
app.ops_close_period(period_id)        -- refuses unless all checks green
app.ops_revenue(market, from, to)      app.ops_unit_economics(market, city?, period)
app.ops_tax_report(market, period)
```

`app.ops_close_period` **returns the failing checklist** rather than closing with warnings. The console's close button reflects that state and stays disabled.

### Config & governance
```
app.ops_market_config(market)          app.ops_propose_config(market, patch)   -- four eyes
app.ops_cities(market)                 app.ops_upsert_city(payload)
app.ops_create_promotion(payload)      -- funded_by NOT NULL; rejects without it
app.ops_feature_flags(market)          app.ops_set_flag(key, scope, enabled)
app.ops_audit(filters)
app.ops_jobs()                         app.ops_trigger_job(name)
app.ops_notifications(filters)         app.ops_resend_notification(log_id)
app.ops_templates(key)                 app.ops_review_template(key, locale, version)
app.ops_start_impersonation(target_user, reason, consent)   -- read-only, hard limit
app.ops_end_impersonation(session_id)
app.ops_request_bulk_export(query, justification)          -- four eyes over 100 PII rows
```

### Four-eyes enforcement

Implemented once, in `app.require_four_eyes(operation, target_id, actor)`:

1. First call inserts a `pending_approval` row and raises `BG130`.
2. Second call by a **distinct** user with the same payload hash executes.
3. Both actors are recorded on the target row and in `audit_log`.

Required on: commission change, payout run approval, refund above `market_config.refund_cap_support_minor`, partner suspension, market activation, market config change, adjustment above threshold, bulk PII export.

Money operations additionally require `app.require_recent_auth(max_age => '5 minutes')` regardless of session age → `BG131`.

## Partner-facing external API — `§11.1`

Base `/v1/partner/`, authenticated by `partner_api_key` (prefix + hash), scoped to `store_ids`, rate-limited per key. Served by the `partner-api-gateway` Edge Function, which validates the key then calls the **same** `app.*` functions as the app. It is a thin adapter, deliberately — if it needs its own logic, the internal function is wrong.

```
POST   /v1/partner/listings              listings:write
PATCH  /v1/partner/listings/:id          listings:write
GET    /v1/partner/orders                orders:read
POST   /v1/partner/orders/:id/redeem     redeem:write   (Idempotency-Key required)
GET    /v1/partner/analytics/summary     analytics:read
```

Outbound webhooks: `order.created`, `order.cancelled`, `order.redeemed`, `listing.sold_out`, `payout.sent`. HMAC-signed with the partner's secret, 6 retries with exponential backoff, then permanent failure and an alert.
