# Decisions log

Technical decisions made during the build that the spec did not settle. Append only; never rewrite an entry.

**When to add a row:** the spec is silent, it is a *technical* question (not product, not money/tax), you decided, and you implemented it. Product questions go to the user. Money and tax questions are in `13-config.md §2` and stay null until decided.

| Date | Decision | Alternatives considered | Why | Reversible? |
|---|---|---|---|---|
| 2026-09-03 | **D1** — `feature_flag` gets a surrogate `uuid` primary key; the spec's four-part key becomes a unique index over the same `coalesce` expressions | Four `not null` columns with `'*'` sentinels; a partial unique index per nullability combination | Postgres does not allow expressions in a `PRIMARY KEY`, so `03-schema.sql` as written does not execute. A unique index preserves the exact identity the spec describes, and the surrogate key gives future foreign keys a target. | Yes — drop the index, redefine the key |
| 2026-09-03 | **D2** — added `create schema if not exists bi` to the RLS migration | Putting `consumer_masked` in `public`; dropping the BI role until phase 10 | `04-rls.sql` creates `bi.consumer_masked` and grants `usage on schema bi`, but never creates the schema, so the file does not execute. RLS test 15 depends on it. | Yes |
| 2026-09-03 | **D3** — `create role bi_reader` wrapped in an existence check | Leaving it to fail on re-run; a separate one-shot bootstrap migration | Migrations are forward-only and re-run on every `supabase db reset`; `CREATE ROLE` has no `IF NOT EXISTS`, so a reset would abort. Roles are cluster-scoped, not database-scoped. | Yes |
| 2026-09-03 | **D4** — extensions created into `extensions` (uuid-ossp, postgis, pg_net) and `cron` (pg_cron) rather than unqualified | Unqualified `create extension`, which lands them in `public` | Hosted Supabase keeps extensions out of `public`; putting postgis there would sit alongside the application tables and collide with the `alter table … enable row level security` sweep in `04-rls.sql`. `pg_cron` requires its own schema. | Yes — relocate with `alter extension … set schema` |
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
