# Bugsha — engineering handoff

You are building **Bugsha** (بقشة), a two-sided surplus-food marketplace launching in **Kuwait and Egypt simultaneously**. Food businesses list unsold end-of-day food as discounted surprise bags; consumers reserve and pay in advance, then collect in person during a pickup window. No delivery in v1. Revenue is commission on each transaction, charged to the partner.

This folder is the specification. It is exhaustive on purpose — where it states a value, use that value; where it states `TODO(decision)`, build the interface and leave the value configurable.

---

## Step 0 — before you write code

1. **Create the repo yourself** on the user's GitHub account: `bugsha` (private). Initialise with the layout in `01-architecture.md §2`.
2. Read, in this order: this file → `00-product.md` → `01-architecture.md` → `02-data-model.md` → `05-money.md`. Do not start on screens before you have read the money document; the ledger shapes the schema.
3. Create a Supabase project per environment (`dev`, `staging`, `prod`). Kuwait and Egypt are **one** Supabase project — market is a column, not a deployment.

## Reading order by task

| You are working on | Read |
|---|---|
| Schema, migrations | `02-data-model.md`, `03-schema.sql`, `04-rls.sql` |
| Anything touching money | `05-money.md` **first**, then `03-schema.sql` |
| Payments, KNET, cash, Fawry | `06-payments.md` |
| Endpoints, Edge Functions | `07-api.md`, `07-openapi.yaml` |
| Cron, background work | `08-jobs.md` |
| Building a screen | `09-screens.md` — every frame code maps to its query and mutation |
| Types, validation | `10-types.md` |
| Copy, Arabic, RTL | `11-i18n.md`, `copy/*.json` |
| Tests | `12-test-plan.md` |
| Market config, open decisions | `13-config.md` |
| Expo, offline, push, store submission | `14-mobile.md` |

## Design source of truth

The visual design is **not** in this folder. It lives in the Bugsha design system as three screen catalogues, and every frame carries a code (`S-C-020`, `S-P-011`, `§7.5`) that `09-screens.md` references:

- **Consumer app** — `ui_kits/consumer/` — 98 frames, `S-C-001` … `S-C-065`
- **Partner platform** — `ui_kits/partner-platform/` — 57 frames, `S-P-001` … `S-P-039` + `§13` edge cases
- **Ops console** — `ui_kits/ops-console/` — 33 frames, `§3` … `§10`

Tokens, components and copy register come from the design system (`styles.css`, `components/`, `guidelines/consumer-copy.card.html`). Do not invent visual values.

---

## Non-negotiable rules

These are the rules that, if broken, produce a system that cannot be fixed later without a data migration and a rewrite.

### Money
1. **All money is `BIGINT` minor units** with an explicit currency. KWD exponent **3** (1.750 KWD = `1750`), EGP exponent **2** (89.50 EGP = `8950`). Never a float. Never a decimal in application code.
2. **The ledger is the source of truth**, not a computation over `orders`. Every money movement writes balanced entries to `financial_entry`. Reports read the ledger.
3. **Commission is resolved at order creation** from the `partner_contract` in force at that instant, and **stored on the order**. It is never recomputed. Changing a rate today can never restate last month.
4. **Ledger entries are immutable.** Corrections are new, reversing entries that reference the original.
5. **Never attempt to debit a partner.** A negative payout carries forward.
6. **No cross-currency aggregation** without a stored FX rate and rate date. Default every report to per-currency.

### Time
7. **Store instants as `TIMESTAMPTZ`; store the partner's intent as local date + local time-of-day separately.** A pickup window is authored as "21:00–22:00 on 3 Sep" in the store's timezone and resolved to UTC. Both are persisted.
8. **Kuwait is `Asia/Kuwait`, UTC+3, no DST. Egypt is `Africa/Cairo`, UTC+2 with DST.** Every scheduled listing must survive an Egyptian DST transition. See `08-jobs.md §dst_integrity_check`.

### Correctness
9. **Every mutation is idempotent** and takes an `Idempotency-Key`. Redeeming an already-redeemed order returns **success with the original record** — never an error that would make a staff member hand over a second bag.
10. **Redemption must work with no network.** The partner client caches the current and next window's orders, queues redemptions locally with a client-generated key and client timestamp, and syncs on reconnect. The ledger records both client and server timestamps.
11. **Authorisation is enforced by RLS**, never by the client. Client navigation reflects permissions; the database decides them.
12. **Ops never edits records directly.** Every privileged action is a named RPC with a reason code, an actor and an audit row.

### Language
13. **Arabic is a first-class language**, not a localisation layer. Three locales: `en`, `ar-KW` (Gulf register), `ar-EG` (Egyptian register). Copy is authored per locale, never machine-translated between the Arabic pair.
14. **Never use "leftover", "expired", "old" or "waste"** about the food in consumer-facing copy, in any language. See `11-i18n.md`.

---

## Stack, decided

| Layer | Choice |
|---|---|
| Consumer + partner apps | **Expo / React Native**, one codebase, iOS + Android |
| Ops console | **Expo web** (same monorepo, `apps/ops`) — dense data surfaces, desktop only |
| Marketing site | Existing Next.js repo, out of scope here |
| Backend | **Supabase only** — Postgres, RLS, Edge Functions (Deno), Realtime, Storage, Auth |
| Scheduling | `pg_cron` + `pg_net` calling Edge Functions |
| Payments — Kuwait | **MyFatoorah** primary, **Tap Payments** as the second adapter behind one interface |
| Payments — Egypt | **Paymob** (card, wallet, InstaPay, Fawry reference) |
| Cash on pickup | Egypt only, first-class. No PSP involved; commission accrues as a receivable |
| Push | Expo Push → APNs / FCM |
| SMS / WhatsApp | `TODO(decision)` per market — see `13-config.md` |

There is **no separate backend service**. Business logic lives in Postgres functions and Edge Functions. If you find yourself wanting a Node service, the answer is a Postgres function with `security definer` or an Edge Function — say so in a comment rather than adding infrastructure.

---

## Build order

Work in this sequence. Each phase is shippable and testable on its own.

| # | Phase | Done when |
|---|---|---|
| 1 | Schema + RLS + seed | `03-schema.sql`, `04-rls.sql` applied; `12-test-plan.md §RLS` green |
| 2 | Auth + market/city selection | A consumer can sign in by phone in both markets and land on an empty browse feed |
| 3 | Partner onboarding + templates + listings | A partner can be approved by fixture and publish a listing in ≤ 3 API calls |
| 4 | Browse, detail, reservation hold | A consumer can hold a bag for 10 minutes without paying |
| 5 | **Money core** — ledger, commission resolution, balance trigger | `12-test-plan.md §ledger` green, including the balance invariant |
| 6 | Payments — Kuwait KNET redirect, all six return states | The ambiguous-return reconciliation path works and cannot double charge |
| 7 | Payments — Egypt card, wallet, Fawry, **cash on pickup** | Cash order accrues `partner_receivable` and nets in a payout |
| 8 | Redemption — online, offline queue, idempotency, undo | `12-test-plan.md §13` cases 2, 5, 6, 15 green |
| 9 | Jobs — holds, no-shows, materialisation, DST check | All cron jobs monitored and alerting |
| 10 | Partner analytics, statements, compliance ledger | Export produces a document a regulator would accept |
| 11 | Payout engine + reconciliation + period close | A full run executes with four-eyes and reconciles |
| 12 | Ops console | Every named operation from `07-api.md §ops` reachable and audited |
| 13 | Disputes, food safety register, quality hold | Illness path bypasses the partner and escalates |
| 14 | Notifications, i18n completeness, campaigns | All three locales reviewed; Ramadan campaign template live |

Do not skip phase 5 to get to screens faster. Everything after it depends on the ledger being right.

---

## Conventions

- **SQL**: `snake_case`, plural table names avoided — singular (`order`, `listing`, `partner`). Reserved words quoted (`"order"`).
- **Money columns**: always suffixed `_minor`, always paired with a `currency CHAR(3)` on the row or resolvable from `market`.
- **Enums**: Postgres enums for closed sets that never grow at runtime (`market`, `entry_type`); lookup tables for sets ops can extend (`reason_code`, `dispute_category`).
- **Timestamps**: `created_at`, `updated_at` on every table; `effective_at` vs `recorded_at` distinguished wherever business time ≠ system time.
- **TypeScript**: types generated from the database (`supabase gen types`), narrowed by Zod at every boundary. Never hand-write a row type.
- **Edge Functions**: one concern per function, named `verb-noun` (`create-listing`, `redeem-order`). Shared code in `supabase/functions/_shared/`.
- **Never** `service_role` from a client. Edge Functions that need it validate the caller's JWT first.

## What to do when this spec is silent or wrong

1. If it is a **product** question — ask the user. Do not invent policy.
2. If it is a **money or tax** question — it is almost certainly in `13-config.md` as a `TODO(decision)`. Build the config, leave the value null, make the code fail loudly rather than defaulting.
3. If it is a **technical** question — decide, implement, and add a note to `docs/DECISIONS.md` with the date and the reasoning.
