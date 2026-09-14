# 12 — Test plan

Four layers. Every item is a test, not a checklist entry.

| Layer | Tool | Scope |
|---|---|---|
| Database | **pgTAP** in `supabase/tests/` | RLS, ledger invariants, state machines, edit rules |
| Unit | Vitest | `packages/core` — money, time, DST, bidi, offline queue |
| Integration | Vitest + local Supabase + PSP sandboxes | Payment flows end to end |
| E2E | Maestro | The §13 edge cases and the performance contracts, on device |

CI gates: no merge if any pgTAP test fails, if the copy lint finds a forbidden term, if a locale key is missing, or if the ledger balance test fails.

---

## §RLS — 15 tests, one per line of `04-rls.sql`

Each runs as a distinct fixture user with `set local role authenticated` and a JWT claim.

| # | Assertion |
|---|---|
| 1 | Staff at store A cannot read orders at store B under the same partner |
| 2 | Staff cannot read `payout`, `statement` or `financial_entry` at all |
| 3 | Manager cannot read `payout`; accountant can, but reads no orders board |
| 4 | Manager can invite `staff` but not `manager` (function-level, raises `BG100`) |
| 5 | Consumer cannot read another consumer's order, payment, wallet or dispute |
| 6 | `anon` reads `v_browse_listing` but zero rows of `consumer_profile` |
| 7 | KW-scoped `ops_manager` sees no EG `consumer_profile`, `order` or `dispute` row |
| 8 | `support_agent` cannot read `financial_entry` |
| 9 | `finance` cannot update `partner` or `listing` |
| 10 | `engineering` cannot approve a payout run |
| 11 | No role can UPDATE or DELETE `financial_entry`, `compliance_entry`, `audit_log` |
| 12 | No role can INSERT `financial_entry` directly — only `app.post_*` |
| 13 | An entry with `effective_at` inside a locked period raises `BG003` |
| 14 | An unbalanced `transaction_id` raises `BG002` at commit |
| 15 | `bi_reader` sees masked phone/email and cannot reach `consumer_profile` |

## §ledger — the tests that protect the business

| # | Case | Assertion |
|---|---|---|
| L1 | Digital capture, KWD | Three entries; `sum(debit) = sum(credit)`; commission = stamped value, not recomputed |
| L2 | Digital capture, EGP | Same, with exponent 2. `8950` renders `89.50 EGP`, never `895.0` |
| L3 | Commission immutability | Capture an order, change the contract rate, re-read: the order's commission is unchanged and `contract_version_id` still points at the old version |
| L4 | Settlement | `platform_bank + psp_fees = cash_in_transit` for the batch |
| L5 | Digital no-show | **Zero entries written.** Status changes only. Retained amount appears as a distinct reporting line |
| L6 | Cash commission | `DR partner_receivable / CR commission_revenue` only. No `cash_in_transit`, no `partner_payable` |
| L7 | Cash netting | Payout nets the receivable; `partner_receivable` returns to zero for that period |
| L8 | Cash no-show | **Zero entries.** No money moved, no commission earned |
| L9 | Refund to source | Reverses payable and commission, credits `refunds_payable`; PSP fee stays in `psp_fees` unless the contract says otherwise |
| L10 | Refund to wallet | Credits `consumer_wallet_liability`; later spend reduces it with no new capture |
| L11 | Goodwill | Debits `goodwill_expense`. **Partner payable unchanged** |
| L12 | Platform-funded promo | Commission computed on **gross**; `promotion_expense_platform` carries the discount |
| L13 | Partner-funded promo | Commission computed on the **discounted** amount; no platform expense |
| L14 | Chargeback, partner bears | Reads `chargeback_bearer = 'partner'` and debits payable |
| L15 | Chargeback, platform bears | Loss lands in `chargeback_losses`; payable untouched |
| L16 | Adjustment without reason code | Rejected |
| L17 | Adjustment above threshold, one approver | Raises `BG130` |
| L18 | Rounding | 22% of `1750` = `385`; residue is absorbed platform-side; `roundHalfUp` in TS and plpgsql agree across 10,000 random inputs |
| L19 | Cross-currency | Aggregating KWD and EGP without a stored FX rate throws |
| L20 | Negative payout | Carries forward as `carry_out_minor`. **No debit is attempted.** Underlying payable entries remain unassigned |
| L21 | Payout failure | Reverts to `pending`; entries not lost; next run picks them up |
| L22 | Period close, dirty | Refuses and returns the failing checklist |
| L23 | Period close, clean, then a late entry | Raises `BG003`; correction posts to the current period referencing the original |
| L24 | Global balance | After a 1,000-order fixture with refunds, promos and chargebacks, every account nets to zero across debits and credits |

**L24 is the test that must never be skipped or quarantined.** If it goes red, stop the line.

## §payments — the matrix from `06-payments.md §8`

Every cell, plus:

| # | Case | Assertion |
|---|---|---|
| P1 | Forged return URL | Success params on the redirect with a provider status of `failed` → order is **not** confirmed |
| P2 | Return before webhook | `getStatus` resolves it; no duplicate ledger transaction when the webhook lands after |
| P3 | Webhook before return | Order already `reserved` when the client returns; the confirm call is a no-op returning the same state |
| P4 | Replayed webhook | Same `provider_ref` produces no second transaction |
| P5 | Ambiguous return | UI exposes **no retry control**; hold extended; poll schedule matches spec; escalates at 10 min |
| P6 | Double capture by provider | Reconciliation flags it; duplicate refunded; net charge zero |
| P7 | Sold out mid-payment | Either no capture, or capture then immediate full refund. Net charge always zero |
| P8 | Fawry expiry | Hold released at reference expiry, not at 10 minutes; stock returns |
| P9 | Cash reservation | No `payment` row, no entries, cap enforced at `reservation_cap_cash` |
| P10 | Cash shortfall accepted | Commission computed on `collected_minor`, not `total_minor` |
| P11 | Provider kill switch | Flag off → method absent from checkout; existing reservations still redeemable |
| P12 | Concurrent hold on the last bag | Exactly one succeeds; the other gets `BG110` |

## §13 — edge cases from the partner spec

Each has a defined outcome, a message in all three locales, and a test.

| # | Case | Expected |
|---|---|---|
| 1 | Store loses power mid-window with reservations outstanding | Cached board and codes work; redemptions queue; **new reservations for that store pause automatically** |
| 2 | Staff redeems the wrong order, undo window passed | Requires `app.ops_reverse_redemption` with a reason code; logged as an exception |
| 3 | Consumer arrives after close, partner wants to honour it | `app.redeem_order_late` inside the grace; records the grace flag; **reverses the consumer's no-show count**; audit entry |
| 4 | Published 20, has 5, must reduce below sold count | `BG114` **naming the sold count**. Never silently clamps. Cancellation offered as the honest alternative |
| 5 | Two devices redeem the same order simultaneously | One redemption row. Second call returns **success with the original**, naming who took it. No error surfaced to staff |
| 6 | Offline queue holds a redemption for an order cancelled online | Resolves to the **earliest** action: the bag was handed over, so the order is honoured, the refund is reversed into partner revenue, ops sees the exception. **Staff are never blamed** |
| 7 | Egyptian DST transition inside an active window | `dst_integrity_check` flags it beforehand; partner is offered a concrete replacement window; no window is silently shifted |
| 8 | Food licence expires mid-day with active listings | New listings blocked; **existing orders honoured**; partner told exactly that |
| 9 | Partner cancels after some orders redeemed, others not | Redeemed orders stand; unredeemed are refunded in full; reliability impact recorded once |
| 10 | Cash order, consumer has insufficient cash | Three sanctioned paths: accept short (commission on collected), card top-up link, release the bag |
| 11 | Consumer disputes a cash order marked collected | Dispute opens; partner statement requested with a deadline; financial outcome recorded on resolution |
| 12 | Bank rejects a payout | Balance carries and ages; escalates to collections above threshold and age; entries preserved |
| 13 | Ramadan begins mid-schedule with pre-Ramadan hours | Schedule suspends itself; partner prompted with an iftar/suhoor pair; **no 18:00 windows published through Ramadan** |
| 14 | Partner operates in both markets under one legal entity | Modelled as **two `partner` rows**; the constraint is stated explicitly during onboarding |
| 15 | Staff member removed while holding queued offline redemptions | Queued redemptions remain **valid and attributed to them**; revocation never rewrites what they did |

## §performance — measured, on device

| Contract | Method | Budget |
|---|---|---|
| Publish from template | Maestro, cold start → confirmation | ≤ 15 s, ≤ 3 taps, ≤ 3 API calls |
| Redeem | Maestro, cold start → confirmed | ≤ 8 s, ≤ 2 taps, **airplane mode** |
| Orders board latency | Integration, insert → Realtime received | ≤ 2 s p95 |
| Redemption confirm | k6 against staging | ≤ 500 ms p95 |
| Listing publish | k6 | ≤ 800 ms p95 |
| Cold start → partner Today | Maestro on a mid-range Android, throttled to 3G | ≤ 3 s |

API-call counting is a hard assertion, not a note: intercept the network layer in the E2E run and fail if the publish path exceeds three.

## §a11y

| Item | Assertion |
|---|---|
| Contrast | WCAG 2.2 AA on all text and meaningful non-text, both themes, both locales — automated over the token pairs |
| Touch targets | ≥ 44×44 pt with adequate spacing; automated over rendered trees |
| Dynamic type | Every screen at the largest accessibility size **reflows, never truncates**. Price and pickup window are never cut |
| Labels | Every interactive element has an accessible label **in all three locales**, asserted from the copy files |
| Reading order | `S-C-021` bag card, `S-C-041` redemption, and every countdown have an asserted reader order |
| Countdowns | Announced at 30, 10 and 5 minutes only. **Never re-announced every second** |
| Reduced motion | Every animation has an asserted reduced-motion equivalent |
| Colour alone | Every state has an icon, label or shape difference — asserted per state component |
| Outdoor legibility | `S-C-041` renders on a white ground at ≥ 48px mono; snapshot-tested against the spec |

## §i18n

| Item | Assertion |
|---|---|
| Key completeness | Every key exists in `en`, `ar-KW`, `ar-EG`. Missing key fails CI |
| Forbidden terms | `copy/_forbidden.json` scan over all copy files fails the build |
| Register distinctness | `ar-KW` and `ar-EG` differ for every one of the 24 core strings — an identical pair is flagged for review, since it usually means one was copied |
| Bidi snapshots | The three worked examples from `11-i18n.md §4` in both directions |
| Numerals | Every numeric component snapshot-tested in both systems |
| Arabic truncation | Never cuts mid-word; asserted against a 40-character Arabic store name |
| Search normalisation | `أحمد`, `احمد`, `أَحمد` all return the same partner |
| Timezone abbreviations | `AST` always for Kuwait; `EET`/`EEST` resolved from the instant for Egypt |

## §jobs

Each job gets: a happy-path test, an idempotency test (run twice, same result), and a failure test.

| Job | Specific assertion |
|---|---|
| `release_expired_holds` | Stock returns; a `sold_out` listing reopens; Fawry holds are **excluded** |
| `mark_no_shows` | Fires at `window_end + grace`, not at `window_end`. Zero ledger entries |
| `reconcile_payments` | A malformed file writes **zero** entries and names the bad rows |
| `dst_integrity_check` | Detects both a non-existent and an ambiguous local time in `Africa/Cairo`; no-ops for Kuwait |
| `materialise_schedules` | Idempotent per `(schedule_id, local_date)`; skips holidays, closures, Ramadan and publishing-blocked stores |
| `check_document_expiry` | On food-licence expiry sets `publishing_blocked_at` and **cancels nothing** |
| `balance_verification` | Detects a deliberately injected imbalance and raises |
| `partner_health_flags` | A 50% two-week listing decline produces a task sorted first |

## §fixtures

`supabase/seed/` must produce, in both markets:

- 2 partners × 4 stores, one with an expired food licence and blocked publishing
- Templates, schedules, and 14 days of materialised listings
- 40 consumers across new, established and restricted (3 no-shows)
- Orders in every `order_status`, with matching ledger transactions
- One Egypt cash order redeemed, one no-showed, one short-collected
- One dispute per severity, including an illness case with a quality hold
- A closed accounting period and an open one
- One payout run with all five exception types
- One reconciliation exception per type
- Ops users for all six roles, KW-scoped and EG-scoped

The fixture set is what makes the ops console and the payout screens testable at all. Build it in phase 1, not phase 11.

## Visual render harness (2026-09-14)

`scripts/render-screens.mjs` screenshots every screen of the consumer, partner and ops apps from a web export, against recorded API fixtures (no network), in English and Arabic at 390×844 (ops at 1280×860). It is how the layout pass is verified without a device.

```
cd apps/consumer && npx expo export -p web --output-dir /tmp/web-consumer     # needs EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY
PLAYWRIGHT_DIR=<dir containing node_modules/playwright-core> node scripts/render-screens.mjs consumer /tmp/web-consumer scripts/fixtures/consumer.json out/consumer
```

`scripts/metro.web-stubs.js` stubs `react-native-maps` and `expo-sqlite` for the web target only; EAS builds are untouched. Fixtures are captured by calling the RPCs as the QA users (`request.jwt.claims` set in a transaction) and saved as JSON; the harness adds a few synthetic rows (a held order, a reserved order with a QR, a cash order on the board, a payout, a quality flag) so every state has a screen. `report.json` lists console errors and redirects per route.
