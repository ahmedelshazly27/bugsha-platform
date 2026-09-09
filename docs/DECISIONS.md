# Decisions log

Technical decisions made during the build that the spec did not settle. Append only; never rewrite an entry.

**When to add a row:** the spec is silent, it is a *technical* question (not product, not money/tax), you decided, and you implemented it. Product questions go to the user. Money and tax questions are in `13-config.md §2` and stay null until decided.

| Date | Decision | Alternatives considered | Why | Reversible? |
|---|---|---|---|---|
| 2026-09-03 | **D1** — `feature_flag` gets a surrogate `uuid` primary key plus `unique (key, market, city_id, cohort) nulls not distinct` | Keeping the `coalesce` sentinels in a unique index; four `not null` columns with `'*'` sentinels; a partial unique index per nullability combination | Two blockers: Postgres forbids expressions in a `PRIMARY KEY`, and the `coalesce(market::text,'*')` form fails in a unique index too because the enum→text cast is STABLE, not IMMUTABLE (42P17). The `'*'` sentinels only ever existed to make NULLs compare equal, which `NULLS NOT DISTINCT` (PG15+) says directly — so this is the spec's intent expressed in the grammar rather than worked around. | Yes — drop the index, redefine the key |
| 2026-09-03 | **D2** — added `create schema if not exists bi` to the RLS migration | Putting `consumer_masked` in `public`; dropping the BI role until phase 10 | `04-rls.sql` creates `bi.consumer_masked` and grants `usage on schema bi`, but never creates the schema, so the file does not execute. RLS test 15 depends on it. | Yes |
| 2026-09-03 | **D3** — `create role bi_reader` wrapped in an existence check | Leaving it to fail on re-run; a separate one-shot bootstrap migration | Migrations are forward-only and re-run on every `supabase db reset`; `CREATE ROLE` has no `IF NOT EXISTS`, so a reset would abort. Roles are cluster-scoped, not database-scoped. | Yes |
| 2026-09-03 | **D4** — extensions created into `extensions` (uuid-ossp, postgis, pg_net) and `cron` (pg_cron) rather than unqualified | Unqualified `create extension`, which lands them in `public` | Hosted Supabase keeps extensions out of `public`; putting postgis there would sit alongside the application tables and collide with the `alter table … enable row level security` sweep in `04-rls.sql`. `pg_cron` requires its own schema. | Yes — relocate with `alter extension … set schema` |
| 2026-09-03 | **D6** — `market_config.vat_coherent` relaxed to `(vat_bp is null) = (vat_base is null)`, plus a new `vat_off_is_unset` check | Seeding EG with `vat_applies = false`; dropping the constraint entirely; a nullable "undecided" enum column | The spec's constraint makes Egypt's own launch row from `13-config.md §1` unrepresentable — `vat_applies = true` with `vat_bp` null pending decision 1. Flipping `vat_applies` to false would make `resolveTax` return zero silently, which `13-config.md §2` explicitly forbids. The replacement still rejects a half-configured rate. | Yes — restore the original once decision 1 lands |
| 2026-09-03 | **D7** — added `app.post_entries()`, a generic balanced-entry writer, in phase 1 | Direct `INSERT` from the seed; deferring all ledger fixtures to phase 5; writing all ten `app.post_*` patterns now | `04-rls.sql` states every entry is written by an `app.post_*` function and gives `financial_entry` no INSERT policy, while `12-test-plan.md §fixtures` requires phase-1 orders to carry matching ledger transactions. The generic primitive satisfies both without pulling phase 5's entry patterns (§3.1–§3.10) forward. | Yes |
| 2026-09-03 | **D8** — implemented `app.invite_staff()` in phase 1 | Deferring RLS test 4 to phase 3; asserting the rule with a plain RLS policy | `04-rls.sql` states the manager-may-only-invite-staff rule is "enforced in the function", and `12-test-plan.md §RLS-4` is one of the fifteen tests phase 1 must pass, so the function is in scope now. RLS cannot express it: the constraint is on the *value being written* relative to the writer's own role. | Yes |
| 2026-09-03 | **D9** — market predicate added to the `consumer_profile`, `dispute`, `wallet_transaction` and (later, via D14's regression test) `financial_entry` select policies | Leaving the spec's policies as written and weakening RLS test 7; scoping only `consumer_profile` | The spec wrote `or app.is_ops()` with no market predicate on these three, which lets a KW-scoped ops user read Egyptian PII. `12-test-plan.md §RLS-7` requires the opposite, and `04-rls.sql`'s own ops section says market scoping "is not optional". Permissive policies OR together, so an unscoped policy silently defeats the scoped ones alongside it. A fourth instance surfaced later on `ledger_partner_read`, where the unscoped ops branch let KW-scoped finance read every Egyptian ledger balance despite `ops_ledger_read` being correctly scoped. **Known remaining gap:** `redemption_read`, `quality_flag_partner`, `notif_own`, `staff_read`, `compliance_read`, `payout_read` and `statement_read` all still carry an unscoped `app.is_ops(...)`. Those tables have no `market` column, so scoping them needs a join or a denormalised column — deliberately not done in passing. | Yes |
| 2026-09-03 | **D10** — pinned `set search_path = ''` on the four ledger/incident trigger functions and schema-qualified `public.financial_entry` / `public.accounting_period` | Setting a permissive search_path on `app.post_entries` instead; qualifying without pinning | The spec declares these triggers with no `search_path` and unqualified table names. A trigger function inherits the *caller's* search_path, so every one of them raises 42P01 the moment it fires inside a `security definer … set search_path = ''` function — which `01-architecture.md §5` mandates for every mutation. Found by the fixture load failing on the very first ledger post. Pinning also closes a search_path capture hole in security-sensitive code. | Yes |
| 2026-09-03 | **D11** — timezone maths in `packages/core/src/time.ts` uses `Intl.DateTimeFormat` directly, with no date library | luxon; date-fns-tz; @js-temporal/polyfill | Every one of those still delegates to the platform's IANA data through Intl, so the dependency buys correctness we already have and costs bundle size against a 3s cold-start budget on a mid-range Android over 3G (`00-product.md §performance`). The conversion is a two-pass offset probe plus a render-back check, which is also what makes non-existent and ambiguous local times detectable rather than silently coerced. | Yes — swap the four exported helpers for a library |
| 2026-09-03 | **D12** — `resolveWindow` reads `end <= start` as crossing midnight, but raises `time.window_too_long` past 12 hours | Rejecting every inverted window (breaks 23:00–00:30); accepting any duration, as the DB constraint does | A real overnight window must work, but `22:00 → 21:00` is a typo, and rolling it to the next day would silently publish a 23-hour window nobody authored. The DB's `window_sane` check only enforces positivity, so this guard has to live in core. Raising rather than clamping follows §13-4. | Yes — the bound is one constant |
| 2026-09-03 | **D13** — the copy lint reads only the three banned groups and honours a reviewed exception list at `packages/i18n/copy/_lint-exceptions.json` | Banning the terms outright; dropping the terms from the ban list; hand-waving the lint into a warning | Two problems with a blanket substring ban. `_forbidden.json` also contains `allowed_register`, the APPROVED vocabulary — matching on it fails the build for using the words §1 asks for. And four legitimate strings contain a banned word about something that is not the food: `safety.headline` is the approved trust line "Surplus. **Not expired**.", and three partner messages are about a **licence** expiring. A gate that cries wolf gets switched off, so each exception names the key, term, locales and reason, and a test asserts every exception is still needed. | Yes |
| 2026-09-03 | **D14** — `security_invoker = on` for `v_browse_listing` and `v_ledger_balance`, plus `grant select on review to anon, authenticated` | Revoking the views from client roles; replacing them with security-definer functions that filter by hand | `03-schema.sql §12` creates both views with no `security_invoker`, and Postgres defaults a view to its OWNER's privileges — so both **bypassed RLS entirely**. Confirmed exploitable on the fixture set before fixing: a staff member who cannot read one `financial_entry` row read all 15 rows of `v_ledger_balance`, every account balance in both markets. The phase-1 suite missed it because every ledger assertion queried the TABLE. Invoker semantics let the policies that already exist do their job; the `review` grant is what `v_browse_listing` then needs for its rating join, and `review_public` already limits it to published rows. | Yes |
| 2026-09-03 | **D15** — `app.require_four_eyes` RETURNS its verdict instead of raising on the first call; callers surface `{status:'pending_approval', errcode:'BG130'}` | Keeping the raise and accepting that four eyes never completes; an autonomous transaction via dblink or pg_background; a separate `request_approval` RPC the client must call first | `07-api.md §four-eyes` says the first call "inserts a pending_approval row **and raises BG130**". In Postgres those two clauses contradict each other: `RAISE` aborts the transaction, rolling back the very INSERT meant to record the first approval — so every call is forever "the first one" and **no four-eyes operation can ever complete**. Proven by ledger test L17, where a second, distinct approver was still refused. Returning the verdict lets the pending row commit; the client still renders the 428 the API doc specifies for BG130, and the security property is unchanged — two distinct actors, both recorded. | Yes |
| 2026-09-03 | **D16** — `app.release_expired_holds` isolates each row in its own block and bounds stock restoration by `quantity_total`, recording anomalies on the `job_run` row | Letting the job abort; a bare `least()` clamp with no record; a nightly repair script | One drifted listing raised `23514 quantity_sane` mid-loop and aborted the whole cron run, so **no** hold anywhere was released. `08-jobs.md` requires every job to be idempotent and safe to re-run, which a mid-loop abort is not. The bound is explicitly not a silent clamp: when it bites, the run records it so the drift stays visible. | Yes |
| 2026-09-03 | **D5** — the app monorepo lives in `ahmedelshazly27/bugsha-platform`, not `bugsha` | Pushing into `bugsha`; renaming the site repo to `bugsha-site` | `docs/00-kickoff.md §1` asks for a repo named `bugsha`, but that name is already the live public marketing site (bugsha.app, Vercel). `CLAUDE.md` puts that site out of scope, and this codebase (schema, RLS, payout logic) should not be public. | Yes — rename either repo |

---

## Already settled by the spec — do not re-open

These are recorded so nobody spends a day re-deciding them. The reasoning is in the linked document.

| Decision | Where |
|---|---|
| One Supabase project, market as a column | `01-architecture.md §3` |
| No separate backend service; Postgres + Edge Functions | `01-architecture.md §1` |
| Double-entry ledger, not computed reports | `05-money.md §1` |
| Commission stamped at order creation, never recomputed | `05-money.md §1.4` |
| Money as `BIGINT` minor units, one rounding function | `05-money.md §1.1`, `10-types.md` |
| Consumer and partner identities in separate namespaces | `02-data-model.md §2` |
| One `partner` row per market | `02-data-model.md §3` |
| Listing snapshots copied at creation | `02-data-model.md §5` |
| `promotion.funded_by` NOT NULL, no default | `02-data-model.md §10` |
| Provider status is authoritative, never the return URL | `06-payments.md §2` |
| No retry control on an ambiguous payment return | `06-payments.md §2` |
| Redemption is idempotent; already-redeemed returns success | `07-api.md`, `12-test-plan.md §13-5` |
| Offline redemption confirms instantly on device | `14-mobile.md §3` |
| Authorisation in RLS, never the client | `04-rls.sql` |
| Two Expo apps, not one with a role switch | `14-mobile.md §1` |

## Template

```
| 2026-09-14 | Used `pg_trgm` + a generated normalised column for Arabic search
              rather than normalising at query time
            | Query-time `unaccent`; a separate search service
            | Query-time normalisation cannot use an index, and browse search
              has to return in under 200 ms on 3G. A generated column keeps it
              in Postgres, which §1 of the architecture doc requires.
            | Yes — drop the column and the index |
```

## D17 — `translate()` Arabic normalisation map
`app.normalise_ar` uses `translate(x, 'أإآىة', 'ااايه')`. The earlier map had four targets for five sources, so `ة` was deleted instead of mapped. Fixed to five-for-five.

## D18 — Trigram search calls `extensions.similarity()` directly
Under `set search_path = ''` the `%` operator from pg_trgm does not resolve. Search functions call `extensions.similarity(a, b) > 0.3` explicitly. Same threshold as the operator's default.

## D19 — `dispute.opened_on` is a real column
The one-open-dispute-per-order-per-day constraint needs a date. `opened_at::date` is not immutable (session time zone), so `opened_on date not null default current_date` is stored and indexed.

## D20 — `payout_allocation` link table
Which ledger entries a payout paid is recorded in `payout_allocation(payout_id, entry_id)`. A failed payout deletes its allocations, freeing the entries for the next run (L21). Entries never move; the link does.

## D21 — `ops_confirm_payout` refuses unknown or non-executing payouts
Confirming a payout that does not exist, or is not in `executing`, raises `BG100`. Before the guard an unknown id was a silent no-op, which a bank-file reconciliation could mistake for success.

## D22 — Client offline store is expo-sqlite behind `@bugsha/offline`'s interface
`@bugsha/offline` stays pure TypeScript (tested with an in-memory store). `apps/partner/src/offline/store.ts` is the SQLite implementation. Codes are hashed with SHA-256 on device so the mirror never holds a redemption code in plain text.

## D23 — Sign-in is by email code, not SMS (2026-09-09)
The founder chose email sign-in to avoid an SMS provider for now. Supabase email OTP is used in both apps. The verified identity is the JWT's confirmed email; `consumer_profile.phone` is now an optional contact number the user types, still validated for the market so the store can call about a late pickup. `resend-otp` takes an email. The spec sections that say "phone is identity" (00-product, 07-api) are superseded by this decision. Production needs custom SMTP in Supabase Auth; the built-in mailer is rate-limited to a few messages an hour.

## D24 — Egypt VAT: 14% on commission, platform e-invoices partners (2026-09-09)
Egypt's standard VAT rate is 14% and applies to service fees; e-invoicing through the Egyptian Tax Authority is mandatory for VAT-registered companies. `vat_bp = 1400`, `vat_base = 'commission'`, `invoicing_mode = 'platform_invoices_partner'`, effective today. VAT is charged on the commission, not on the bag price, because the partner sells the food and the platform sells a service. Registering the entity on the ETA portal is an operational task.

## D25 — Kuwait: no VAT, configuration stays ready
The Kuwaiti government's current four-year plan rules out VAT before 2028. `vat_applies = false`. `resolve_tax` still refuses a null rate if `vat_applies` is ever flipped on.

## D26 — One legal entity per market
Payment providers, tax registration and food-authority registration are all national. A Kuwaiti company contracts Kuwaiti partners; an Egyptian company contracts Egyptian partners. Platform entity names are config strings filled in at registration.

## D27 — Payment providers: MyFatoorah (KW, Tap secondary), Paymob (EG)
Tap covers both countries but is not onboarding new Egyptian merchants. Provider per market is a config row.

## D28 — PSP fees absorbed by the platform
Partners see one deduction, the commission. Fees are a platform cost line, as at Too Good To Go.

## D29 — Chargebacks borne by the platform, recoverable on evidenced non-fulfilment
Default `chargeback_bearer = 'platform'`. Where a chargeback follows a partner's documented failure (listing cancelled after the window, no-show marked on a redeemed order), Ops recovers via an adjustment with a reason code.

## D30 — Cash commission is invoiced, in both markets (founder decision)
`cash_settlement_mode = 'invoice'` by default and on all existing contracts. Cash on pickup is enabled in Kuwait as well (`cash_enabled = true`, `cash` added to payment methods, cap 1 per new cash user). Invoice generation itself is the remaining piece of work.

## D31 — Payout cadence confirmed: weekly, Sunday
Minimums: 5.000 KWD, 250 EGP.

## D32 — Payout channel: manual (founder decision)
`market_config.payout_channel = 'manual'`. Finance downloads the run's bank rows and confirms each payout in the console. Bank-file and API channels are future values of the same column.

## D33 — No-show: partner retains; cash writes nothing
Confirmed as built.

## D34 — Refunds: full both ways; PSP fee on refunds is a platform cost
Confirmed as built.

## D35 — Retention 10 y (KW) / 5 y (EG); deletion within 30 days
Kuwait commercial and tax law requires accounting records for ten years. Egypt's VAT executive regulations require five years from the end of the fiscal year. Egypt's data-protection executive regulations (Decree 816/2025, enforced from Oct 2026) expect data-subject requests to be answered within about 30 days; Kuwait's DPPR has no fixed number, so 30 days is applied to both. `request_deletion` now schedules erasure of identity fields on that clock; financial rows are retained and pseudonymised.

## D36 — Charity leg and insurance deferred
No donation ledger account and no partner insurance clause at launch. Revisit before 50 stores.
