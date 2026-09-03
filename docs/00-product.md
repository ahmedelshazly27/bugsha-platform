# 00 — Product

## What it is

A two-sided marketplace for surplus prepared food. Restaurants, cafés, bakeries, patisseries, juice bars, grocers, hotels and caterers list food that is unsold at close as discounted "surprise bags". Consumers reserve and pay in advance, then collect in person at the store during a defined pickup window.

The consumer does **not** know the exact contents before collection. They know: the category, the value range, the price, the pickup window, and the store.

**No delivery in v1.** Every flow assumes the consumer physically arrives.

## The central design problem

Discounted end-of-day food must feel like a **smart win** — never charity, scraps, or a clearance bin.

- In Egypt, any hint that this is "food for poor people" kills adoption among the paying audience.
- In Kuwait, any hint of "old food" triggers safety anxiety.

Consequences that reach the code:
- The word set in `11-i18n.md` is enforced. "Leftover", "expired", "old", "waste" never appear about the food.
- Urgency is generated only by **real information** — minutes remaining, bags remaining, distance. Never manufactured scarcity.
- Sustainability is an after-effect, never the headline. Money saved is the primary metric everywhere, including the impact screen.
- Guilt is never a motivator, in copy or in notification triggers.

## Two markets, not one market with a toggle

| Dimension | Kuwait | Egypt |
|---|---|---|
| `market` code | `KW` | `EG` |
| Currency | KWD, **exponent 3** (`1750` = 1.750) | EGP, **exponent 2** (`8950` = 89.50) |
| Typical bag price | 1.000–3.000 | 50.00–200.00 |
| Payments | KNET (bank redirect), Apple Pay, card | Card, mobile wallet, InstaPay, Fawry reference, **cash on pickup** |
| Cash on pickup | **Not offered** | **First-class, expected** |
| Aggregator | MyFatoorah (primary), Tap (secondary adapter) | Paymob |
| Language default | Arabic, Gulf register (`ar-KW`) | Arabic, Egyptian register (`ar-EG`) |
| Timezone | `Asia/Kuwait` UTC+3, **no DST** | `Africa/Cairo` UTC+2, **DST observed** |
| Weekend | Fri–Sat | Fri–Sat |
| Phone | `+965`, 8 digits | `+20`, 10 digits after the leading zero |
| Address model | Governorate → Area → Block → Street → Building | Governorate → District → Street → Building |
| Food regulator (trust copy) | PAFN | NFSA |
| KYB documents | MOCI commercial licence, food permit per location, Civil ID, signatory authorisation, IBAN | Commercial register extract, tax card, health licence per location, National ID, bank or wallet |
| VAT | No regime today. Field exists, configured off | 14% on commission `TODO(decision)` — see `13-config.md` |
| Live cities at launch | Al Asimah, Hawalli, Farwaniya, Mubarak Al-Kabeer, Ahmadi, Jahra | Cairo, Giza, Alexandria |
| Car culture | Very high; drive-thru pickup common | Mixed; dense urban walk-up |

**Both markets launch day one.** One Supabase project; `market` is a column on every scoped table and part of every RLS predicate.

### Design implications that are actually testable

- Every price component tolerates a rendered string of **4 to 12 characters** without truncation or reflow.
- Numeral system is a **user setting** with a market default. Every numeric component renders Western (`0-9`) and Arabic-Indic (`٠-٩`).
- Every time display renders a timezone abbreviation when ambiguity is possible (`AST`, `EET`, `EEST`).
- One legal entity cannot serve both markets. A partner trading in both is **two `partner` rows**, stated explicitly during onboarding.

## The three surfaces

| Surface | App | Primary user | Session | Device |
|---|---|---|---|---|
| Consumer | `apps/consumer` | Anyone buying a bag | 1–4 min | Phone |
| Partner | `apps/partner` | Shift staff at 22:45, standing, one-handed | 15–90 s | Phone; counter tablet; owner desktop |
| Ops | `apps/ops` | Internal — support, ops, finance, compliance, engineering, admin | 20–60 min | Desktop web |

The partner surface is **one application with three entry surfaces**, not three apps. Role decides the landing screen and the visible navigation. A staff account never sees payouts; an owner lands on the multi-branch view, not the till.

### Hard performance contracts

These are acceptance criteria, not aspirations. See `12-test-plan.md §performance`.

| Path | Budget |
|---|---|
| App open → listing published from template | ≤ 15 s, ≤ 3 taps, ≤ 3 API calls |
| App open → order redeemed | ≤ 8 s, ≤ 2 taps, **completes with no network** |
| New reservation → visible on orders board | ≤ 2 s p95 |
| Redemption confirmation | ≤ 500 ms p95 online; instant local confirmation offline |
| Listing publish | ≤ 800 ms p95 |
| Cold start → partner Today view | ≤ 3 s on a mid-range Android on 3G |
| Session persistence | A full shift without re-auth; shortest session for `owner` |

## Business rules the interface must express

Each of these must be legible in the UI without a support article. The frame that carries it is named.

| # | Rule | Where it shows |
|---|---|---|
| 1 | Pickup windows are partner-set, 30–120 min typical. No redemption before open or after close. | `S-C-030`, `S-C-040`, `S-P-011` |
| 2 | Reservations close at window end, or earlier if the partner sets a cutoff. | `S-C-030` |
| 3 | Consumer cancellation permitted until **2 h** before window open; after that, no self-service. | `S-C-032`, `S-C-043` |
| 4 | Partner cancellation permitted any time; triggers automatic full refunds, notifies consumers, counts against reliability. | `S-P-015` |
| 5 | Unredeemed at window close = no-show. Default: **no refund**; partner retains. Cash orders simply release. | `S-C-044`, `S-P-019` |
| 6 | Per-user, per-listing and per-day caps. New users and cash users have lower caps. | `S-C-031`, `S-C-032` |
| 7 | Listed price ≤ a configured fraction (default **50%**) of stated minimum value. Value range must be honest. Platform may reject. | `S-P-006`, `§4.4` |
| 8 | Refund timing differs by method and market, and is stated **at the moment of refund**. | `S-C-043`, `S-C-047` |
| 9 | Only users who redeemed may rate. | `S-C-045` |
| 10 | The platform never guarantees contents. Every dietary surface repeats it without becoming noise. | `S-C-015`, `S-C-030` |
| 11 | No age restriction. **Alcohol is never listed** in either market — rejected by category validation. | `S-P-006` |
| 12 | Reliability scores exist for both partners and consumers, and are surfaced honestly to the party they concern. | `§6.3`, `S-C-044` |

## Revenue model

Commission on each transaction, charged to the partner, deducted at payout. Default **22%** `TODO(decision: confirm)`, per market, overridable per category and per partner via contract version.

Revenue recognition: commission is recognised at **redemption**, not reservation — the service is delivered on collection. No-show retained revenue is recognised at window close and reported as a **distinct line**, because it is economically different from a fulfilled sale and partners will query it.

Cash orders (Egypt): the platform never touches the money, so only commission is recognised, as a **receivable** from the partner, settled by netting against digital payouts or by invoice. This is the single largest predicted source of Egyptian partner disputes — see `05-money.md §7.3.3`.
