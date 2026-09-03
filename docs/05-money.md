# 05 — Money

> This is the least forgiving part of the system. Read it before writing any schema. If you implement money as computed reports over the `order` table, the platform cannot be reconciled, cannot be audited, and breaks the first time a commission rate changes. That failure is not recoverable without a data migration.

## 1. Non-negotiables

1. **Integer minor units, always.** `BIGINT`. KWD exponent **3**, EGP exponent **2**. `1.750 KWD = 1750`. `89.50 EGP = 8950`. No floats, no `numeric` for amounts, no decimal strings in application code.
2. **Double-entry.** Every movement writes balanced entries to `financial_entry`, grouped by `transaction_id`. `sum(debits) = sum(credits)` per currency, per transaction, enforced by a constraint trigger.
3. **Immutable entries.** No `UPDATE`, no `DELETE` — privileges revoked from every application role. Corrections are reversing entries referencing the original.
4. **Commission stamped at order creation** from the contract in force at that instant. Stored on the order. Never recomputed.
5. **One rounding function.** Round-half-up at the minor unit, in `core/money.ts` and its plpgsql twin. Rounding residue from commission is absorbed by the **platform** side and never silently redistributed.
6. **No cross-currency aggregation** without a stored FX rate and a documented rate date. Reports default to per-currency; a consolidated view is separate and clearly labelled.
7. **Every entry traces** to a source event (`reference_type` + `reference_id`) and a `contract_version_id` where commission is involved.
8. **The platform never debits a partner.** Negative balances carry forward, age, and escalate.

## 2. Chart of accounts

Per market and currency.

| Account | Nature | Holds |
|---|---|---|
| `cash_in_transit` | Asset | Captured by the PSP, not yet settled to our bank |
| `platform_bank` | Asset | Settled funds |
| `partner_payable` | Liability | Owed to partners |
| `partner_receivable` | Asset | Commission owed **by** partners on cash orders |
| `commission_revenue` | Revenue | Platform earnings |
| `psp_fees` | Expense | Payment processing cost |
| `refunds_payable` | Liability | Approved, not yet disbursed |
| `consumer_wallet_liability` | Liability | Credits held by consumers |
| `promotion_expense_platform` | Expense | Platform-funded discounts |
| `promotion_contra_partner` | Contra-liability | Partner-funded discounts |
| `vat_payable` | Liability | Output tax where applicable |
| `chargeback_losses` | Expense | Unrecoverable chargebacks |
| `goodwill_expense` | Expense | Discretionary credits |
| `unreconciled_suspense` | Asset/Liability | Temporary. **Must be zero at period close.** |

## 3. Entry patterns

Implement each as a plpgsql function in `app`, called inside the transaction that performs the state change. Each is named below.

### 3.1 Digital order, captured — `app.post_order_capture()`

Kuwait KNET/card, Egypt card/wallet/InstaPay/Fawry.

```
DR cash_in_transit          gross
  CR partner_payable        gross − commission
  CR commission_revenue     commission
```

`commission` = `order.commission_minor`, stamped at creation. Not derived here.

**On PSP settlement** — `app.post_settlement()`:
```
DR platform_bank            gross − psp_fee
DR psp_fees                 psp_fee
  CR cash_in_transit        gross
```

**On payout** — `app.post_payout()`:
```
DR partner_payable          payout amount
  CR platform_bank          payout amount
```

### 3.2 Digital order, no-show — no entries

Policy default: the partner retains the revenue. **No reversal.** The order's status becomes `no_show`, and the retained amount is tagged in reporting as a distinct line, because it is economically different from a fulfilled sale and partners will query it.

`no_show_policy` is a **contract term** (`partner_contract.no_show_policy`) — read it, do not assume. `TODO(decision)`: whether it differs for cash. See `13-config.md`.

### 3.3 Cash order, redeemed (Egypt) — `app.post_cash_commission()`

The platform never touches the money. Only commission is recognised, as a receivable.

```
DR partner_receivable       commission
  CR commission_revenue     commission
```

**Settlement by netting** (default) — inside the payout run:
```
DR partner_payable          commission
  CR partner_receivable     commission
```

**Settlement by invoice**, when digital volume is insufficient:
```
DR platform_bank            commission
  CR partner_receivable     commission
```

> This is the single largest predicted source of Egyptian partner disputes. The partner surface must show, at all times: cash collected today, commission owed on cash, and how it will be settled. Ambiguity here costs more in support load than the commission is worth.

### 3.4 Cash order, no-show — no entries

No money moved, no commission earned. The order is recorded and released.

### 3.5 Refund, full, before redemption — `app.post_refund()`

```
DR partner_payable          gross − commission
DR commission_revenue       commission
  CR refunds_payable        gross
```
On disbursement:
```
DR refunds_payable          gross
  CR platform_bank          gross
```

**PSP fees are typically not returned on refund.** Recognise the retained fee as `psp_fees` expense — **not** as a partner deduction — unless `partner_contract.psp_fee_bearer = 'partner'`. `TODO(decision)`.

### 3.6 Refund as wallet credit — `app.post_refund_to_wallet()`

```
DR partner_payable            gross − commission
DR commission_revenue         commission
  CR consumer_wallet_liability  gross
```
Later wallet spend reduces the liability and funds a new order **without a new capture**.

### 3.7 Goodwill credit, platform-funded — `app.post_goodwill()`

```
DR goodwill_expense            amount
  CR consumer_wallet_liability amount
```

The partner is unaffected. **This must be the default whenever the service failure was the platform's**, and the ops console must make it hard to accidentally charge a partner for a platform error — see the force-cancel frame in `ui_kits/ops-console/` §4.3.

### 3.8 Platform-funded promotion — `app.post_promo_capture()`

Consumer pays the discounted price; the partner receives the full expected amount.

```
DR cash_in_transit             discounted
DR promotion_expense_platform  discount
  CR partner_payable           gross − commission
  CR commission_revenue        commission
```

**Commission is computed on gross when the platform funds the discount.** When the partner funds it, commission is computed on the discounted amount and there is no platform expense:

```
DR cash_in_transit             discounted
  CR partner_payable           discounted − commission_on_discounted
  CR commission_revenue        commission_on_discounted
```

This distinction is explicit in `promotion.funded_by`, which is `NOT NULL` with no default.

### 3.9 Chargeback — `app.post_chargeback()`

```
DR partner_payable          gross − commission   (only if contract allows recovery)
DR commission_revenue       commission
DR chargeback_losses        unrecoverable portion + fee
  CR platform_bank          chargeback amount + fee
```

Whether the partner bears chargeback risk is `partner_contract.chargeback_bearer`. Read it. `TODO(decision)`.

### 3.10 Manual adjustment — `app.post_adjustment()`

Requires a `reason_code`, four-eyes above `market_config.adjustment_four_eyes_threshold_minor`, and produces balanced entries with `created_by` set to the approving users. No adjustment may be posted without a reason code — the column is `NOT NULL`.

## 4. VAT and tax

Support, **per market, by configuration**:

- Whether VAT applies to the **commission**, to the **gross transaction**, or not at all.
- The rate in basis points, with **effective dates**. Historical rates are preserved; a rate change never restates a closed period.
- Whether the platform issues a tax invoice to the partner, the partner issues one to the platform, or self-billing applies.
- Consumer-facing tax display requirements.

Current state:

| Market | Position |
|---|---|
| Egypt | Operates a VAT regime; a commission service will generally attract it, and compliant tax invoices — potentially through the electronic invoicing system — will likely be required. **`TODO(decision)`: rate treatment, invoicing mechanism, e-invoicing registration.** |
| Kuwait | No VAT implemented as of writing. `vat_applies = false`, `vat_bp = null`. Excise and a future VAT must be accommodated **by configuration, not code**. |

Neither statement substitutes for local tax advice. Build the config; leave the values null; make the code raise rather than default to zero silently.

**Tax entries are ledger entries like any other.** Never a report-time calculation.

## 5. Payout engine

Cadence configurable per market and per partner; weekly and bi-weekly are the practical options.

```
1  FREEZE     select partner_payable entries with effective_at in period,
              not already assigned to a payout
2  AGGREGATE  per partner, per currency
3  NET        cash-order commission receivable, refunds, chargebacks,
              adjustments, prior carry-over
4  THRESHOLD  below market_config.payout_min_minor → carry forward
5  VALIDATE   bank details present and verified · partner not suspended ·
              no open critical dispute above value threshold ·
              computed amount not negative
6  GENERATE   statements — PDF + CSV, order-level detail
7  REVIEW     finance reviews exceptions: negative balances, large variance
              vs prior period, first payouts, flagged partners
8  APPROVE    four-eyes, two distinct users, re-auth regardless of session age
9  EXECUTE    bank file or disbursement API per market
10 CONFIRM    reconcile bank confirmation against expected; mark paid;
              handle failures
```

**Negative payout:** never attempt a debit. Carry forward, make visible to the partner, age it, escalate to collections above a threshold and age. Design the payout row to hold `carry_in_minor` and `carry_out_minor` explicitly rather than inferring.

**Payout failure** (invalid account, rejected transfer): revert the payout to `pending`, notify partner and finance, and **do not lose the underlying payable entries** — they remain unassigned and roll into the next run.

**Traceability requirement:** a partner must reach any number on a statement down to individual transactions in **at most two taps**. Every adjustment line expands to its constituent orders.

## 6. Reconciliation

Three run continuously. A period cannot close until all three are clean.

### 6.1 PSP reconciliation

Provider settlement report vs internal `payment` records, matched on `provider_ref`.

Exception types, each with a resolution workflow:

| Exception | Meaning | Resolution |
|---|---|---|
| Captured, not settled beyond expected timing | Provider hasn't paid us | Chase provider; no entry |
| Settled, not recorded | We missed a webhook | Match to order → post capture + settlement |
| Amount mismatch | Fee or partial capture | Investigate; adjust with reason code |
| Duplicate capture | Double charge | Refund the duplicate immediately |

Unmatched amounts sit in `unreconciled_suspense` until cleared. Nothing clears silently.

### 6.2 Bank reconciliation

Platform bank statement vs `platform_bank` entries, covering settlements in and payouts out.

### 6.3 Cash reconciliation (Egypt)

Partner-reported cash collected vs orders marked `cash_collected`, variance tracked **per store per day**.

Persistent variance is a **fraud and training signal**, not an accounting footnote — it feeds the partner health/intervention queue. Threshold and window in `market_config`.

### 6.4 Period close

An explicit operation, not a date passing:

- All three reconciliations clean
- `unreconciled_suspense` at zero
- Ledger balanced (daily job green)
- Statements issued
- Tax reports generated
- Period **locked**: no new entry may carry `effective_at` inside it

Post-close corrections go to the **current** period with a reference to the original entry. The close button stays **disabled**, not warning — closing a period that cannot later be audited is worse than closing late.

## 7. Reporting

- GMV, net revenue (commission), take rate — by market, city, category, partner, cohort.
- **Recognition:** commission at **redemption**. No-show retained revenue at window close, as a **distinct line**.
- Unit economics per city: revenue per order, PSP cost per order, SMS/push cost per order, support cost per order, CAC by channel, contribution margin, payback.
- Cohorts: consumer retention and revenue by acquisition month; partner retention and GMV by activation month.
- Forecasting inputs: listings per active partner, sell-through, order frequency per active consumer.

## 8. Integrity checks to implement

| Check | Frequency | On failure |
|---|---|---|
| Per-transaction balance | Constraint trigger, every write | Reject the transaction |
| Global balance per account per currency | Daily 03:00 | **Page on-call.** This is the most important alarm in the system. |
| `unreconciled_suspense` = 0 | Daily, and at close | Block close |
| Every `order` with `payment_status = captured` has capture entries | Daily | Alert finance |
| Every `payout` marked paid has payout entries | Daily | Alert finance |
| No entry with `effective_at` inside a locked period | Constraint | Reject |
| Commission on order = contract rate × base, recomputed as a check | Daily sample | Alert; investigate rounding |
