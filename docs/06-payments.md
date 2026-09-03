# 06 — Payments

One interface, three providers, two markets. **The client never calls a provider.** It asks our Edge Function for a payment session and receives a URL or a token; everything else happens server-to-server or via webhook.

## 1. The adapter interface

`supabase/functions/_shared/psp/types.ts`

```ts
export interface PspAdapter {
  readonly provider: 'myfatoorah' | 'tap' | 'paymob';
  readonly market: 'KW' | 'EG';

  createSession(input: {
    orderId: string;
    amountMinor: bigint;
    currency: 'KWD' | 'EGP';
    method: PaymentMethod;
    returnUrl: string;          // deep link back into the app
    callbackUrl: string;        // our webhook
    consumer: { id: string; phone: string; firstName: string };
    idempotencyKey: string;
  }): Promise<{
    providerRef: string;
    redirectUrl?: string;       // KNET, card 3DS, InstaPay
    fawryReference?: string;    // Egypt Fawry
    expiresAt?: string;
  }>;

  /** Authoritative status. Called on ambiguous return and by reconciliation. */
  getStatus(providerRef: string): Promise<PspStatus>;

  refund(input: {
    providerRef: string; amountMinor: bigint;
    reason: string; idempotencyKey: string;
  }): Promise<{ providerRef: string; status: 'pending' | 'done' }>;

  verifyWebhook(req: Request, rawBody: string): Promise<boolean>;
  parseWebhook(rawBody: string): PspEvent;

  /** Settlement file or API, for reconciliation. */
  fetchSettlement(date: string): Promise<SettlementRow[]>;
}

export type PspStatus =
  | 'pending' | 'authorised' | 'captured' | 'settled'
  | 'failed' | 'cancelled' | 'unknown';
```

Adapters: `myfatoorah.ts`, `tap.ts`, `paymob.ts`. Resolution is by `market_config.payment_methods` plus a `psp_primary` flag per market, so switching Kuwait from MyFatoorah to Tap is a config row, not a deploy.

**Rule:** an adapter may not touch the database. It returns data; `app.record_payment_event()` writes it. This keeps the ledger transactional and the adapters unit-testable with fixtures.

## 2. Kuwait — MyFatoorah primary, Tap secondary

KNET is a **bank redirect**. The app leaves, the user authenticates at their bank, and comes back. Everything hard about Kuwaiti payments is in that round trip.

### Flow

```
1  client → POST /functions/v1/create-payment { orderId, method: 'knet' }
2  server: app.hold_listing() already ran; order is 'held', hold_expires_at = +10 min
3  adapter.createSession() → { providerRef, redirectUrl }
4  server: insert payment(status='pending', provider_ref, redirect_url)
5  client opens redirectUrl in an in-app browser (expo-web-browser)
6  bank authenticates → provider redirects to returnUrl (deep link)
7  client → POST /functions/v1/confirm-payment { orderId }
8  server: adapter.getStatus(providerRef)  ← AUTHORITATIVE, not the return params
9  captured → app.confirm_order() → ledger capture entries → order 'reserved'
```

> **Step 8 is the whole design.** Never trust the redirect's query parameters to decide payment state. The return URL tells you the user came back; the provider's API tells you whether money moved. Screenshot-forged return URLs are a real attack.

### The six return states — all must be built

| State | Detected by | Behaviour | Frame |
|---|---|---|---|
| **Success** | `getStatus` = captured | Confirm order, post capture entries, show code | `S-C-035` |
| **Failed** | `getStatus` = failed | Nothing charged. Name the likely cause (daily limit, online-payment block). Offer another method. Hold survives. | `S-C-036` |
| **Cancelled by user** | `getStatus` = cancelled | Return to checkout with the hold intact and its remaining time visible | `S-C-032` |
| **Network failure mid-redirect** | Client never returned; hold expiring | Background `confirm-payment` on next app open; if captured, confirm the order and notify | `S-C-034` |
| **Ambiguous** | `getStatus` = unknown, or app resumed with no result | **Reconciliation state. No retry button.** Poll `getStatus` with backoff for 10 min; hold the bag; notify either way. | `S-C-034` |
| **Sold out during payment** | Capture succeeded but `quantity_remaining = 0` | **Guarantee no charge:** immediate full refund, and say "you have not been charged — no refund needed" only when the capture never completed. Offer alternatives inline. | `S-C-036` |

### Ambiguous return — the one that causes double charges

```
order stays 'held', hold extended to +10 min from resume
payment.status = 'ambiguous'
UI: "Checking your payment" · no retry control, explicitly labelled as unavailable
background: getStatus() at 2s, 5s, 10s, 20s, 40s, 60s, then every 60s to 10 min
  captured  → confirm, notify, release the UI
  failed    → release hold, offer another method
  unknown at 10 min → escalate to reconciliation_exception, release the hold,
                      notify the consumer that nothing was taken and to retry
```

`app.confirm_order()` is idempotent on `payment.provider_ref`. Calling it twice for the same reference returns the existing order state. This is what makes the retry-free design safe.

### Apple Pay

Through the same adapter as a card, using the provider's Apple Pay session. Requires the merchant certificate against the Apple developer account — see `14-mobile.md §Apple`. Never a separate ledger path; it is a digital capture like any other.

## 3. Egypt — Paymob, plus cash

Five methods, and **cash is not a fallback**. It is first-class in the UI, in the schema, and in the ledger.

| Method | Mechanism | Notes |
|---|---|---|
| Card | Paymob iframe / 3DS redirect | Standard capture |
| Mobile wallet | Paymob wallet, phone-number initiated | Redirect or push-to-app |
| InstaPay | Paymob → bank app handoff | Treat return like KNET: `getStatus` is authoritative |
| Fawry reference | Paymob generates a reference | Order held until paid or expiry |
| **Cash on pickup** | No PSP at all | Commission accrues as `partner_receivable` |

### Fawry reference

```
createSession → { fawryReference, expiresAt }
order stays 'held' with hold_expires_at = fawryExpiresAt   ← NOT the 10-min default
UI: S-C-032 Fawry frame — reference, countdown, payment instructions
webhook on payment → app.confirm_order()
expiry with no payment → app.release_hold(), notify, bag returns to sale
```

The hold duration for Fawry is the reference lifetime (typically hours), which is deliberately longer than every other hold. Do not apply `market_config.hold_duration_minutes` to Fawry.

### Cash on pickup

```
reservation:  order.method = 'cash', payment_status = 'none', status = 'reserved'
              NO payment row, NO ledger entries
              cap: market_config.reservation_cap_cash (default 1 open order for new users)
redemption:   app.redeem_order() + app.collect_cash(collected_minor)
              → cash_collection row
              → app.post_cash_commission():  DR partner_receivable / CR commission_revenue
no-show:      NO entries. Order released. No money moved, no commission earned.
```

**The confirmation sheet is mandatory** (`S-C-032` cash frame) and must state: the amount to bring, that exact change helps at closing time, the no-show consequence, and the lower cap — once, without lecturing. Equal dignity to KNET is an explicit design requirement, not a nicety.

**Cash shortfall at the counter** (`§13.10`): three sanctioned outcomes, each a named function.

| Outcome | Function | Ledger |
|---|---|---|
| Accept the short amount | `app.collect_cash(collected_minor < expected)` | Commission on **what was actually collected**, not the listed price |
| Consumer pays the rest by card | `app.create_topup_payment()` | Normal digital capture for the balance |
| Release the bag | `app.release_order()` | No entries; returns to sale if the window is open |

## 4. Webhooks

One Edge Function per provider: `psp-webhook-myfatoorah`, `psp-webhook-tap`, `psp-webhook-paymob`.

```
1  read the raw body BEFORE parsing — signature verification needs the exact bytes
2  adapter.verifyWebhook() → on failure, insert payment_event(signature_valid=false)
                             and return 200. Never leak validity to a prober.
3  insert payment_event(...)                      ← append-only, always, even duplicates
4  app.record_payment_event(payment_event_id)     ← plpgsql, transactional
     · idempotent on (provider, provider_ref, event_type)
     · posts ledger entries where the event warrants it
     · advances order status
5  return 200 quickly. Retries are the provider's job; our processing is idempotent.
```

`payment_event` is the audit trail. When finance asks "did we receive that notification", the answer is a row, not a log search.

## 5. Refunds

```
app.request_refund(order_id, amount_minor, destination, reason_code, cost_bearer)
  → refund row, status 'requested'
  → app.post_refund() or app.post_refund_to_wallet()   (see 05-money.md §3.5–3.6)
  → Edge Function calls adapter.refund() for destination='source'
  → provider webhook or reconciliation marks it disbursed
```

**Refund timing must be stated at the moment of refund**, not only in the policy document (business rule 8):

| Destination | Kuwait | Egypt |
|---|---|---|
| Wallet credit | Instant | Instant |
| KNET card | 3–5 working days | — |
| Card | 3–5 working days | 5–14 working days |
| Wallet / InstaPay | — | 1–3 working days |
| Cash order | No money moved; simply released | No money moved; simply released |

These strings live in `copy/refund-timing.json` per locale, keyed by `(market, destination)`. Never hardcode them in a component.

**PSP fees are not returned on refund.** Recognise the retained fee as `psp_fees` expense, not a partner deduction, unless `partner_contract.psp_fee_bearer = 'partner'`. `TODO(decision)`.

## 6. Chargebacks

Arrive by webhook or settlement file. `app.post_chargeback()` reads `partner_contract.chargeback_bearer` to decide whether the partner's payable is debited or the loss sits in `chargeback_losses`. `TODO(decision)`: the contract term itself.

Consumer-side effect: chargeback history is recorded on `consumer_profile` and feeds restriction decisions (`S-C-064`).

## 7. Reconciliation hooks

`reconcile-settlement` runs hourly per provider (see `08-jobs.md`). It calls `adapter.fetchSettlement(date)` and matches on `provider_ref`.

**The job validates the entire file before writing anything.** A truncated or reformatted file must produce zero entries, not partial ones — otherwise real captures get marked missing and land in suspense. This exact failure has a runbook (`§8.6`, and the runbook frame in `ui_kits/ops-console/`).

## 8. Test matrix

Every cell is a test in `12-test-plan.md §payments`. Provider sandboxes only; no live keys in CI.

| | Success | Declined | Cancelled | Timeout | Ambiguous | Sold out mid-flight | Duplicate webhook | Refund |
|---|---|---|---|---|---|---|---|---|
| KNET (MyFatoorah) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| KNET (Tap) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Apple Pay | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | ✓ |
| Card EG (Paymob) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Wallet EG | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| InstaPay | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Fawry | ✓ | — | ✓ | expiry | ✓ | ✓ | ✓ | ✓ |
| Cash | ✓ | short | release | — | — | n/a | n/a | n/a |

Additional non-negotiable cases:

- **No double charge**, ever, under any interleaving of return + webhook + retry.
- **Sold-out-during-payment guarantees no net charge** — either no capture, or a capture immediately and fully refunded.
- **Ambiguous return offers no retry control** until status resolves.
- A **replayed webhook** with the same `provider_ref` produces no second ledger transaction.
