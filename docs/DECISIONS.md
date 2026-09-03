# Decisions log

Technical decisions made during the build that the spec did not settle. Append only; never rewrite an entry.

**When to add a row:** the spec is silent, it is a *technical* question (not product, not money/tax), you decided, and you implemented it. Product questions go to the user. Money and tax questions are in `13-config.md §2` and stay null until decided.

| Date | Decision | Alternatives considered | Why | Reversible? |
|---|---|---|---|---|
| — | *(first entry goes here)* | | | |

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
