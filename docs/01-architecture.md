# 01 — Architecture

## 1. Shape

```
Expo apps (consumer, partner, ops-web)
        │  supabase-js  ·  JWT  ·  RLS enforced in Postgres
        ▼
┌──────────────────────────────────────────────────────────┐
│ Supabase project (one per environment, both markets)     │
│                                                          │
│  Postgres 15                                             │
│    · tables + RLS + enums + lookup tables                │
│    · plpgsql functions = business logic (security definer)│
│    · financial_ledger with a balance-enforcing trigger    │
│    · pg_cron  → pg_net → Edge Functions                   │
│                                                          │
│  Edge Functions (Deno)   external I/O only                │
│    · payment provider calls + webhook receivers           │
│    · payout file / API execution                          │
│    · push, SMS, WhatsApp dispatch                         │
│    · PDF + CSV generation (statements, ledger export)     │
│                                                          │
│  Realtime   orders board, live ops dashboard              │
│  Storage    KYB documents, dispute photos, store images   │
│  Auth       phone OTP, email, Apple, Google               │
└──────────────────────────────────────────────────────────┘
        │
        ▼  outbound only, from Edge Functions
MyFatoorah · Tap · Paymob · Expo Push · SMS/WhatsApp · bank payout channel
```

**Rule:** Postgres owns state transitions and money. Edge Functions own everything that leaves the building. If a piece of logic needs no network, it belongs in a plpgsql function so it is transactional and testable with `pgTAP`.

## 2. Repository layout

Monorepo, pnpm workspaces, Expo Router in each app.

```
bugsha/
  apps/
    consumer/            Expo — iOS, Android
      app/               expo-router routes, mirrors S-C-* flows
      src/features/      browse, reservation, checkout, redemption, account
    partner/             Expo — iOS, Android, tablet layouts
      app/
      src/features/      today, listings, orders, redeem, money, ledger, staff
    ops/                 Expo web only (Metro web), desktop
      app/
      src/features/      partners, marketplace, disputes, money, config, tooling
  packages/
    ui/                  design-system components ported from the DS project
    tokens/              generated from the DS styles.css — do not hand-edit
    core/                money, time, market, validation, permission helpers
    api/                 typed Supabase client + query/mutation hooks
    i18n/                copy JSON + locale + numeral + bidi helpers
    offline/             mutation queue, idempotency keys, cache policy
  supabase/
    migrations/          numbered SQL, forward-only
    functions/           Edge Functions, one folder each
      _shared/           psp adapters, auth guard, ledger helpers, notify
    seed/                per-market seed data
    tests/               pgTAP
  docs/                  this folder
```

### Why `packages/core` matters

Four things must exist in exactly one place, or the system will drift:

| Module | Responsibility |
|---|---|
| `core/money.ts` | `Money = { minor: bigint, currency: 'KWD' \| 'EGP' }`. Construction, arithmetic, the single `round()` function, formatting per locale. **No other file may format or round money.** |
| `core/time.ts` | Local-intent ↔ UTC instant resolution per store timezone; window state machine; DST-safe arithmetic. |
| `core/market.ts` | Market config accessor. Every market-varying value is read from here, never branched inline on `market === 'KW'`. |
| `core/permissions.ts` | The role matrix, mirrored from RLS for **navigation only**. Never the enforcement point. |

## 3. Environments

| Env | Supabase | Payments | Notes |
|---|---|---|---|
| `dev` | Local (`supabase start`) | Provider sandboxes | Seeded with both markets |
| `staging` | Hosted project | Provider sandboxes | Full cron enabled; used for the §13 test pass |
| `prod` | Hosted project | Live keys | Cron enabled; alerting wired |

Secrets live in Supabase Function secrets and EAS secrets. **Nothing provider-related in the client bundle** — the client never sees a PSP key, and never calls a PSP directly. The client's only payment interaction is opening a URL the server returned.

## 4. Client architecture

### Data access

- `@tanstack/react-query` over `supabase-js`. One hook per screen contract in `09-screens.md`.
- Reads: direct table/view selects under RLS, or an RPC where the read needs a computed shape.
- Writes: **always** an RPC or Edge Function. Never a direct `insert`/`update` from a client on any table that money, state machines or audit depend on. RLS makes direct writes impossible on those tables anyway.
- Realtime: `postgres_changes` on `order` filtered by store for the orders board; on `listing` for the live ops dashboard.

### Offline (partner app, mandatory — see `14-mobile.md`)

```
SQLite (expo-sqlite) mirror
  · current + next window's orders for assigned stores
  · redemption codes (hashed comparison locally)
  · pending mutation queue: { client_id, op, payload, client_ts, attempts }

Redemption while offline:
  1. validate the code against the local mirror
  2. write the local mirror + queue entry, client_id = uuidv4()
  3. show CONFIRMED to staff immediately
  4. on reconnect, POST the queue with Idempotency-Key = client_id
  5. server records client_ts AND server_ts in the compliance ledger
```

Conflicts resolve to the **earliest** redemption and surface a non-blocking notice. See `12-test-plan.md §13-6`.

### State

- Server state: react-query only. No Redux.
- Device/session state: Zustand — locale, numerals, market, active shift member, offline queue status.
- Never derive money or window state in a component. Call `core/money.ts` / `core/time.ts`.

## 5. Backend patterns

### Business-logic functions

Named `app.<verb>_<noun>`, `security definer`, `set search_path = ''`, and every one:

1. Resolves the caller (`auth.uid()`) and asserts authorisation explicitly, even under RLS.
2. Validates inputs and raises a **coded** exception (`ERRCODE` + a message key resolvable in all three locales — see `11-i18n.md §errors`).
3. Performs the state transition and writes any ledger entries **in the same transaction**.
4. Writes an `audit_log` row when the action is privileged.
5. Returns the full resulting record so the client never needs a follow-up read.

```sql
-- shape of every mutation
create or replace function app.redeem_order(
  p_order_id      uuid,
  p_idempotency   text,
  p_client_ts     timestamptz default null,
  p_staff_user    uuid default null
) returns app.redeem_result
language plpgsql security definer set search_path = '' as $$ ... $$;
```

### Idempotency

One table, checked by every mutation:

```
idempotency_key(key text primary key, actor uuid, operation text,
                request_hash text, response jsonb, created_at timestamptz)
```

On a repeat key with a matching hash → return the stored response. On a repeat key with a **different** hash → raise `409 idempotency_conflict`. Retention 30 days.

### Edge Functions

Only for outbound I/O and inbound webhooks. Every function:

- Verifies the caller — user JWT for client-invoked, provider signature for webhooks, cron secret for scheduled.
- Is idempotent on the provider's reference.
- Writes nothing to money tables directly; it calls a plpgsql function so the ledger stays transactional.

| Function | Trigger | Purpose |
|---|---|---|
| `create-payment` | Client | Ask the PSP for a payment session, return the redirect URL |
| `psp-webhook-myfatoorah` / `-tap` / `-paymob` | Provider | Verify signature → `app.record_payment_event()` |
| `reconcile-settlement` | Cron | Fetch settlement file, match on provider reference |
| `execute-payout-run` | Ops, after four-eyes | Generate the bank file or call the disbursement API |
| `send-notification` | Trigger / cron | Render the template for the locale, dispatch per channel |
| `generate-document` | Client / cron | Statement PDF+CSV, compliance ledger export, incident report |
| `materialise-schedules` | Cron | 14-day rolling listing materialisation |

## 6. Failure posture

| Failure | Behaviour |
|---|---|
| PSP unreachable | New reservations continue; payment step shows a retryable state. Kill switch per provider in `feature_flag`. |
| PSP returns ambiguous | **No retry offered.** Enter reconciliation state, hold the bag 10 min, resolve from the provider's record. Never risk a double charge. |
| Realtime down | Orders board falls back to a 10 s poll. Banner states the degradation. |
| Partner device offline | Cached board + queued redemptions. New reservations for that store pause automatically — nobody buys a bag the store cannot see. |
| Cron job fails | Alert with a runbook link. Jobs are idempotent and safe to re-run. `reconcile_payments` validates the whole input before writing anything. |
| Push undeliverable | Fall back per market config. Operationally critical notifications also send SMS/WhatsApp and bypass quiet hours. |

## 7. Observability

- **Ledger balance job** daily at 03:00, alerts on any imbalance. This is the single most important alarm in the system.
- Job monitoring surface: `§8.1` in the ops console. Prominence for `release_expired_holds`, `mark_no_shows`, `reconcile_payments`, `dst_integrity_check`.
- Structured logs from Edge Functions with `market`, `partner_id`, `order_id`, `idempotency_key`.
- Every alert links to a runbook (`§8.6`).
