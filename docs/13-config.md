# 13 — Configuration and open decisions

Two jobs: document every value that varies by market, and record every decision that is **not yet made** so nobody hardcodes a guess.

## 1. Launch configuration

Seed `market_config` with these. Values marked `TODO` must stay null and make the code raise — never default to zero.

| Field | KW | EG |
|---|---|---|
| `currency` / `exponent` | KWD / **3** | EGP / **2** |
| `timezone` / `observes_dst` | Asia/Kuwait / false | Africa/Cairo / **true** |
| `locales` | `{en, ar-KW}` | `{en, ar-EG}` |
| `default_locale` | `ar-KW` | `ar-EG` |
| `numerals_default` | `western` | `western` |
| `payment_methods` | `{knet, apple_pay, card, cash}` | `{card, wallet, instapay, fawry, cash}` |
| `cash_enabled` | **true** (D30) | **true** |
| `default_commission_bp` | `2200` `TODO(confirm)` | `2200` `TODO(confirm)` |
| `vat_applies` | `false` | `true` |
| `vat_bp` | `null` | `1400` |
| `vat_base` | `null` | `commission` |
| `invoicing_mode` | `platform_invoices_partner` | `platform_invoices_partner` |
| `regulator_name` | `PAFN` | `NFSA` |
| `price_min_minor` / `price_max_minor` | `500` / `15000` | `2500` / `75000` |
| `max_price_fraction` | `0.50` | `0.50` |
| `reservation_cap_default` | `3` | `3` |
| `reservation_cap_new_user` | `2` | `2` |
| `reservation_cap_cash` | n/a | `1` |
| `hold_duration_minutes` | `10` | `10` |
| `cancel_cutoff_hours` | `2` | `2` |
| `late_redeem_grace_minutes` | `30` | `30` |
| `undo_redeem_seconds` | `120` | `120` |
| `payout_cadence` / `payout_day` | weekly / Sunday | weekly / Sunday |
| `payout_min_minor` | `5000` | `25000` |
| `refund_cap_support_minor` | `20000` | `100000` |
| `adjustment_four_eyes_minor` | `50000` | `250000` |
| `cash_variance_threshold_minor` | n/a | `1000` |
| `cash_liability_escalate_minor` / `_days` | n/a | `300000` / `30` |

### Cities at launch

**Kuwait, all `live`:** Al Asimah · Hawalli · Farwaniya · Mubarak Al-Kabeer · Ahmadi · Jahra
**Egypt, `live`:** Cairo · Giza · Alexandria
**Egypt, `waitlist`:** Qalyubia · Dakahlia · Port Said

Selecting a non-`live` city routes to the waitlist screen (`S-C-005`).

### Document requirements

| Market | `doc_type` | Per store | Blocks publishing on expiry |
|---|---|---|---|
| KW | `moci_licence` | no | no |
| KW | `food_permit` | **yes** | **yes** |
| KW | `civil_id` | no | no |
| KW | `signatory_authorisation` | no | no |
| KW | `bank_iban` | no | no |
| EG | `commercial_register` | no | no |
| EG | `tax_card` | no | no |
| EG | `health_licence` | **yes** | **yes** |
| EG | `national_id` | no | no |
| EG | `bank_or_wallet` | no | no |

### Holidays suppressing materialisation

Kuwait: Eid al-Fitr, Eid al-Adha, National Day (25 Feb), Liberation Day (26 Feb), Islamic New Year, Prophet's Birthday.
Egypt: Eid al-Fitr, Eid al-Adha, Coptic Christmas (7 Jan), Revolution Day (25 Jan), Sinai Liberation (25 Apr), Labour Day, 30 June, Revolution Day (23 Jul), Armed Forces Day (6 Oct).

Islamic dates move annually — seed them per year and set a calendar reminder. Partners can override per schedule.

### Feature flags at launch

| Key | KW | EG | Kill switch |
|---|---|---|---|
| `reservations_enabled` | on | on | ● |
| `cash_on_pickup` | off | on | ● |
| `psp_myfatoorah` | on | — | ● |
| `psp_tap` | off | — | ● |
| `psp_paymob` | — | on | ● |
| `partner_onboarding` | on | on | ● |
| `push_notifications` | on | on | ● |
| `consumer_map_view` | on | on | |
| `partner_bulk_publish` | on | on | |
| `partner_pos_api` | off | off | |
| `consumer_hijri_dates` | scheduled | scheduled | |
| `wallet_topup` | off | off | |

Kill switches take effect within **30 seconds**, are logged, alert on-call, and post to the incident channel. Turning reservations off leaves redemption of existing orders working.

---

## 2. Open decisions — `TODO(decision)`

None of these are decided. Each blocks a specific part of the build. **Engineering must not resolve them unilaterally.** Build the interface, leave the value null, and make the code raise loudly.

These are also surfaced in the ops console (`§10` frame) with owners and dates, so a shipping deadline cannot quietly decide a tax position.

| # | Decision | Blocks | Owner | Interim behaviour |
|---|---|---|---|---|
| 1 | **Egypt VAT** on commission | **Decided 2026-09-09 (D24)** | 14% on the platform commission (`vat_bp = 1400`, `vat_base = commission`); platform issues ETA-compliant e-invoices to partners. Operational: register the Egyptian entity on the ETA e-invoicing portal |
| 2 | **Kuwait tax position** | **Decided (D25)** | No VAT before 2028 per the government's four-year plan. `vat_applies = false`; config path stays ready |
| 3 | **Contracting legal entity per market** | **Decided (D26)** | One local entity per market: a Kuwaiti company contracts Kuwaiti partners, an Egyptian company contracts Egyptian partners. Names are config strings, filled in at registration |
| 4 | **Payment aggregator per market** | **Decided (D27)** | MyFatoorah primary in Kuwait (Tap secondary); Paymob in Egypt. Tap is not onboarding Egyptian merchants |
| 5 | **PSP fees** | **Decided (D28)** | Platform absorbs (`psp_fee_bearer = platform`). Commission is priced to cover them; partner statements stay one line |
| 6 | **Chargeback liability** | **Decided (D29)** | Platform bears by default (`chargeback_bearer = platform`); recovered from the partner only on evidenced non-fulfilment, via an adjustment with reason code |
| 7 | **Cash commission settlement** | **Decided by founder 2026-09-09 (D30)** | **Invoiced** in both markets (`cash_settlement_mode = invoice`), never netted. Cash enabled in Kuwait too. Monthly invoice; ageing and escalation already built |
| 8 | **Payout cadence and minimum** | **Confirmed (D31)** | Weekly, Sunday; minimums as above. Payout channel `manual` for now (D32) |
| 9 | **No-show revenue** | **Confirmed (D33)** | Partner retains; cash writes no entries |
| 10 | **Refund policy** | **Confirmed (D34)** | Full refund both ways; PSP fee on refunds is a platform cost |
| 11 | **Data retention and deletion clock** | **Decided (D35)** | Financial records 10 y (KW, commercial law) / 5 y (EG, VAT regulations); deletion honoured within 30 days in both (`deletion_clock_days = 30`), identity fields only — financial rows are pseudonymised, not deleted |
| 12 | **Charity / donation leg** | **Deferred (D36)** | No ledger account at launch; `no_show_disposition = donated` stays reporting-only |
| 13 | **PAFN / NFSA registration** | **Operational** | Register and export built to the strictest reading; registration is a founder task per market |
| 14 | **Insurance** | **Deferred (D36)** | Not a contract term at launch; partners keep their own liability cover; revisit before 50 stores |

### How to handle a `TODO(decision)` in code

```ts
// packages/core/src/market.ts
resolveTax(market: Market, base: Money, at: Date): Money {
  const cfg = this.get(market);
  if (!cfg.vatApplies) return zero(cfg.currency);
  if (cfg.vatBp === null || cfg.vatBase === null) {
    // Decision 1. Do NOT return zero — an accidental zero-rate is a tax
    // liability nobody discovers until an audit.
    throw new AppError('BG150', { market, decision: 1 });
  }
  return commissionOf(base, cfg.vatBp);
}
```

**The pattern is always the same:** the interface exists, the value is null, the code raises with the decision number. Never a silent default.

---

## 3. Things that are decided, so stop asking

| Question | Answer |
|---|---|
| One Supabase project or two? | **One.** Market is a column. |
| Separate backend service? | **No.** Postgres functions + Edge Functions. |
| Both markets at launch? | **Yes.** |
| Ops console — separate app? | **No.** Expo web in the same monorepo. |
| Marketing site? | Existing Next.js repo, out of scope. |
| Delivery? | **Never in v1.** Every flow assumes physical collection. |
| Alcohol? | **Never listed**, either market. Rejected by category validation. |
| Consumer and partner accounts unified? | **No.** Separate namespaces, deliberately. |
| Can a partner trade in both markets on one account? | **No.** Two `partner` rows. Stated during onboarding. |
| Commission recomputed when a rate changes? | **Never.** Stamped at order creation. |
| Can ops edit a record directly? | **No.** Every mutation is a named operation with a reason code. |
| Is a promotion valid without funding attribution? | **No.** `NOT NULL`, no default. |
| Does the platform ever debit a partner? | **No.** Negative balances carry forward. |

---

## 4. Still needed from the user

Non-blocking for the docs, blocking for a live launch:

1. **Apple Developer account type** — Individual or Organization. An **Organization** account is required for the partner app if staff at other businesses will install it, and for the merchant certificates behind Apple Pay. Individual is workable for the consumer app alone.
2. **Google Play Console** — set up, or not yet.
3. **Bundle IDs / package names** — reserved, or should Claude Code claim `org.bugsha.consumer`, `org.bugsha.partner`.
4. **Provider sandbox credentials** — MyFatoorah, Tap, Paymob. Needed for phase 6 onward; everything before that runs on fixtures.
5. **Platform legal entity name and registration numbers**, for statements and tax documents (decision 3).
6. **Support channel numbers** — WhatsApp business numbers per market, and the partner support line.
7. **The `TODO(decision)` answers**, in the order they block: 1, 3, 5, 6, 7, 11.
