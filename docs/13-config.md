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
| `payment_methods` | `{knet, apple_pay, card}` | `{card, wallet, instapay, fawry, cash}` |
| `cash_enabled` | **false** | **true** |
| `default_commission_bp` | `2200` `TODO(confirm)` | `2200` `TODO(confirm)` |
| `vat_applies` | `false` | `true` |
| `vat_bp` | `null` | **`TODO(decision 1)`** |
| `vat_base` | `null` | **`TODO(decision 1)`** |
| `invoicing_mode` | `platform_invoices_partner` | **`TODO(decision 1)`** |
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
| 1 | **Egypt VAT** on commission: rate, base, invoicing mechanism, e-invoicing registration | `05-money.md §4`, statements, `app.resolve_tax` | Finance + counsel | `vat_bp = null`; `resolve_tax` raises `BG150`. Egypt cannot go live on payouts until set |
| 2 | **Kuwait tax position** — build now or configure later | `05-money.md §4` | Finance | `vat_applies = false`. Config exists; no code path assumes zero forever |
| 3 | **Contracting legal entity per market**, and whether one entity can serve both | Contract records, statements, `partner` modelling | Founders + counsel | One `partner` row per market, enforced. Platform entity name is a config string, currently placeholder |
| 4 | **Payment aggregator per market**, settlement timing, fee structure | `06-payments.md` | Finance | Both KW adapters built behind one interface; primary is a config row |
| 5 | **PSP fees absorbed or passed to partners** | `05-money.md §3.5`, `psp_fee_bearer` | Founders | `psp_fee_bearer = 'platform'`, read from contract so a change is a new version |
| 6 | **Chargeback liability allocation** | `05-money.md §3.9`, `chargeback_bearer` | Counsel | `chargeback_bearer = 'platform'`, read from contract |
| 7 | **Cash commission settlement**: netting vs invoicing, and collections when netting is impossible | `05-money.md §3.3`, payout engine | Finance | `cash_settlement_mode = 'net'`; carry-forward and ageing built; invoice generation stubbed |
| 8 | **Payout cadence and minimum per market** | Payout engine | Finance | Weekly Sunday; minimums as above. Config-driven, no code change to alter |
| 9 | **No-show revenue policy** — partner retains, split, or refunded; and whether cash differs | `05-money.md §3.2`, `no_show_policy` | Founders | `partner_retains`, read from contract. Cash already writes no entries |
| 10 | **Refund policy**: partner-cancelled vs consumer-cancelled, and PSP fee treatment on refunds | `06-payments.md §5` | Founders | Full refund both ways; PSP fee to `psp_fees` |
| 11 | **Data residency and retention** per market, and the deletion statutory clock | `§6.6`, `§8.5`, `app.request_deletion` | Counsel | Retention: 7 y financial (KW), 5 y (EG) — **placeholders**. Deletion clock is a config integer, currently null and raises |
| 12 | **Charity or donation leg** — does one exist, and its accounting treatment | Ledger accounts, impact metrics | Founders + counsel | `no_show_disposition = 'donated'` is captured for reporting only. **No ledger account exists yet** — deliberately |
| 13 | **PAFN / NFSA platform registration**, and any rule on discounted resale of prepared food | `§5.2` register, trust copy | Compliance | Register and export built to the strictest reading of both |
| 14 | **Insurance position** on food safety incidents; whether partners must carry cover as a contract term | Contract terms, `§5.2` | Founders + broker | Not a contract term today |

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
