# 08 — Jobs

All scheduling is `pg_cron` in the Supabase project. Jobs that need no network are plpgsql called directly; jobs with outbound I/O use `pg_net` to invoke an Edge Function with a cron secret.

Every job:

1. Writes a `job_run` row (`started_at`, `finished_at`, `status`, `rows_affected`, `error`, `runbook_key`).
2. Is **idempotent** and safe to re-run at any time.
3. Validates its whole input before writing anything — partial writes are worse than no writes.
4. Alerts on failure with a runbook link. Surfaced in the ops console `§8.1`.

Times are UTC. The four jobs marked **critical** are given visual prominence in the ops console because the product breaks without them.

## Schedule

| Job | Cron | Kind | Critical |
|---|---|---|---|
| `release_expired_holds` | `* * * * *` | plpgsql | ● |
| `mark_no_shows` | `*/5 * * * *` | plpgsql | ● |
| `close_expired_listings` | `*/5 * * * *` | plpgsql | |
| `reconcile_payments` | `0 * * * *` | Edge | ● |
| `expire_fawry_references` | `*/10 * * * *` | plpgsql | |
| `poll_ambiguous_payments` | `*/2 * * * *` | Edge | |
| `materialise_schedules` | `0 22 * * *` | plpgsql | |
| `dst_integrity_check` | `0 23 * * *` | plpgsql | ● |
| `check_document_expiry` | `0 5 * * *` | plpgsql | |
| `balance_verification` | `0 0 * * *` | plpgsql | ● |
| `refresh_reliability_scores` | `30 0 * * *` | plpgsql | |
| `partner_health_flags` | `0 6 * * *` | plpgsql | |
| `expire_wallet_credit` | `0 1 * * *` | plpgsql | |
| `sweep_idempotency_keys` | `0 2 * * *` | plpgsql | |
| `escalate_unacked_flags` | `*/15 * * * *` | plpgsql | |
| `escalate_breaching_disputes` | `*/15 * * * *` | plpgsql | |
| `age_cash_liability` | `0 7 * * 1` | plpgsql | |
| `freeze_payout_run` | per market cadence | plpgsql | |
| `send_scheduled_notifications` | `* * * * *` | Edge | |
| `retry_partner_webhooks` | `*/5 * * * *` | Edge | |
| `sync_warehouse` | `0 3 * * *` | Edge | |

---

## release_expired_holds — critical

Every minute. Releases `order.status = 'held'` past `hold_expires_at`, returning stock.

```sql
update "order" o set status = 'cancelled_consumer', cancelled_reason_code = 'hold_expired'
where o.status = 'held' and o.hold_expires_at < now()
returning o.order_id, o.listing_id, o.quantity;
-- then: increment listing.quantity_remaining, re-open status if it was sold_out
```

**Excludes Fawry holds** — their `hold_expires_at` is the reference lifetime, and `expire_fawry_references` owns them so the copy and notification differ.

**Failure mode:** stock stays locked and the bag looks sold out. Consumer-visible within minutes. Page if two consecutive runs fail.

## mark_no_shows — critical

Every five minutes. Any `reserved` order past `window_end_utc + late_redeem_grace_minutes` becomes `no_show`.

- Digital: **no ledger entries.** Partner retains per `partner_contract.no_show_policy`. Status change and a compliance entry only.
- Cash: **no entries.** Simply released.
- Increments `consumer_profile.no_show_count_90d`; at 3 in 90 days, sets `restricted_until` (rule 5, `S-C-064`).
- Prompts the partner for a disposition (`S-P-019`) — one tap, feeds the compliance ledger and impact metrics.

The grace window means a late redemption inside it still succeeds. Do not mark at `window_end_utc` exactly.

## reconcile_payments — critical

Hourly, per provider, per market. See `06-payments.md §7`.

```
1  adapter.fetchSettlement(date)
2  VALIDATE THE WHOLE FILE. Any unparseable row → abort, write zero entries,
   raise with the row numbers. A truncated file must not mark real captures missing.
3  match on provider_ref
4  matched   → app.post_settlement()
   exceptions → reconciliation_exception rows, amounts into unreconciled_suspense
```

Exception types and their workflows are in `05-money.md §6.1`.

**Failure mode:** blocks the payout run freeze and period close. Not consumer-visible until the run freezes for the next payout. Runbook: `reconcile_payments_failed`.

## dst_integrity_check — critical, Egypt only

Nightly. Kuwait has no DST and the job no-ops there.

For every future materialised listing and every active schedule in `Africa/Cairo`:

```
resolve local_date + local_start in the store timezone
  → non-existent local time (spring forward, the skipped hour)
  → ambiguous local time  (autumn back, the repeated hour)
```

On a hit: write a `job_run` warning, alert ops, **and notify the partner** with a concrete suggested replacement window (`§13.7` frame). Never silently shift a window; never publish into an hour that will not exist.

Run a broader sweep 14 days before each transition so the whole materialisation horizon is validated at once.

## materialise_schedules

Nightly at 22:00 UTC. Rolling **14-day** horizon.

```
for each active listing_schedule:
  for each date in horizon where extract(dow) = any(weekdays):
    skip if market_holiday.suppress_materialisation and no per-schedule override
    skip if store_closure
    skip if schedule.ramadan_suspended_from <= date <= ramadan_suspended_to
    skip if a listing already exists for (schedule_id, local_date)   ← idempotency
    skip if store.publishing_blocked_at is not null                  ← expired licence
    resolve local_start/local_end → UTC via store.timezone
    insert listing with snapshots copied from the template
```

- Materialised listings are individually editable and cancellable without touching the schedule.
- A schedule pause stops future materialisation; already-materialised listings survive.
- **Ramadan:** schedules flagged `ramadan_affected` are suspended over the Ramadan window and the partner is prompted to author a post-iftar / pre-suhoor pair. Never continue publishing 18:00 windows through Ramadan.

## check_document_expiry

Daily. This is a **regulatory control**, not an administrative nicety.

```
30 days out  → notify the partner owner (bypasses quiet hours), flag in health queue
7 days out   → notify again, escalate to the account owner in ops
on expiry    → set doc.status = 'expired'
               if market_document_requirement.blocks_publishing_on_expiry:
                 set store.publishing_blocked_at = now()
                 cancel nothing; existing orders are honoured
               notify the partner with the exact consequence
```

The partner-facing screen must state plainly that sold bags are unaffected — otherwise the first reaction is to panic-cancel tonight's orders.

## balance_verification — critical

Daily at midnight UTC. **The most important alarm in the system.**

```sql
-- 1. per-transaction (belt and braces; the trigger should make this impossible)
select transaction_id, currency,
       sum(case when entry_type='debit' then amount_minor else -amount_minor end) delta
from financial_entry group by 1,2 having delta <> 0;

-- 2. global per market per currency
select market, currency,
       sum(case when entry_type='debit' then amount_minor else -amount_minor end) delta
from financial_entry group by 1,2 having delta <> 0;

-- 3. suspense must be zero
select * from v_ledger_balance
where account = 'unreconciled_suspense' and balance_minor <> 0;

-- 4. every captured order has capture entries
-- 5. every paid payout has payout entries
-- 6. commission recomputed from the contract matches the stamped value (sampled)
```

Any non-zero delta **pages on-call**. Do not downgrade this alert.

## partner_health_flags

Daily at 06:00. Writes intervention tasks, not a report — see the health queue frame in `ui_kits/ops-console/` §3.5.

| Signal | Condition | Suggested action |
|---|---|---|
| Listing decline | listings/week down ≥ 50% over two weeks | Call the owner today |
| No first listing | `active` ≥ 7 days, zero listings | Onboarding call |
| Cancellation rate | > threshold over 30 days | Review with the manager |
| Rating decline | 30-day avg down ≥ 0.4 | Send portioning guidance |
| Sell-through low | < threshold over 14 days | Pricing or quantity review |
| Document expiring | ≤ 30 days | Automated reminder sent |
| Payout failure | any failed payout | Fix bank details |
| Cash liability aging | > threshold minor or days | Raise invoice |

**Listing decline is the leading indicator.** Churn in this model is almost always preceded by two weeks of declining listing frequency, so it sorts to the top of the queue.

## escalate_unacked_flags / escalate_breaching_disputes

Every 15 minutes.

- A `quality_flag` past `ack_deadline` → `escalated_at = now()`, notify ops. The partner is not given a second chance to ignore it.
- A `dispute` past `sla_due_at` and unresolved → surface as breaching; `critical` severity pages Compliance.
- **Suspected foodborne illness never waits on the partner.** The partner statement is requested with a deadline, but escalation and the quality-hold decision proceed regardless.

## freeze_payout_run

Per market cadence (`market_config.payout_cadence` / `payout_day`). Executes steps 1–6 of the payout engine (`05-money.md §5`), leaving the run in `ready` for finance review. Approval and execution are **never** automated — four eyes and re-auth, always.

Refuses to freeze if `reconcile_payments` has failed since the last successful run.

## Other jobs, briefly

| Job | Behaviour |
|---|---|
| `close_expired_listings` | `active` → `closed` past `window_end_utc`; `sold_out` when `quantity_remaining = 0` |
| `expire_fawry_references` | Release holds on expired Fawry references, notify, return stock |
| `poll_ambiguous_payments` | `getStatus()` with backoff for payments in `ambiguous`; escalate to a reconciliation exception at 10 minutes |
| `refresh_reliability_scores` | Recompute partner, store and consumer scores with component breakdowns (`§6.3`) |
| `expire_wallet_credit` | Expire goodwill credit past `expires_on`; `DR consumer_wallet_liability / CR goodwill_expense` reversal |
| `sweep_idempotency_keys` | Delete keys older than 30 days |
| `age_cash_liability` | Weekly; age `cash_liability`, escalate above threshold and age, propose an invoice |
| `send_scheduled_notifications` | Dispatch due reminders; respects quiet hours except for the bypass list |
| `retry_partner_webhooks` | Exponential backoff, 6 attempts, then permanent failure and an alert to the partner |
| `sync_warehouse` | Push operational + financial tables to BI with PII masked by default (`§8.5`) |

## Runbooks — `§8.6`

Every alert links to one. Each runbook states, per step, **what it does to the ledger**, because the wrong recovery writes entries that cannot be unwound.

| Key | Covers |
|---|---|
| `psp_outage` | Provider down: kill switch, consumer messaging, backlog handling |
| `realtime_outage` | Orders board falls back to polling; degradation banner |
| `mass_partner_cancellation` | Bulk refunds, consumer comms, reliability impact |
| `food_safety_incident` | Quality hold, register entry, regulator posture |
| `payout_failure` | Failed transfer: carry-forward, partner comms, re-execution |
| `reconcile_payments_failed` | Malformed settlement file: re-issue, manual matching, four-eyes |
| `dst_transition` | Pre-transition checklist for Egypt, both directions |
| `ledger_imbalance` | **Stop-the-line.** Freeze payouts, identify the transaction, post reversals |
