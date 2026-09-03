# 14 — Mobile: Expo, offline, push, store submission

## 1. Project setup

```
apps/consumer   org.bugsha.consumer    iOS + Android
apps/partner    org.bugsha.partner     iOS + Android, phone + tablet layouts
apps/ops        —                      Expo web only (Metro web), desktop
```

Two separate apps, deliberately. A consumer and a partner staff member are different identities (`02-data-model.md §2`), and a shift manager should not be able to sideways-navigate into a consumer feed at the counter.

```jsonc
// apps/partner/app.json — the settings that matter
{
  "expo": {
    "orientation": "default",              // tablet needs landscape
    "userInterfaceStyle": "automatic",     // dark mode is a designed state
    "ios": { "supportsTablet": true, "bundleIdentifier": "org.bugsha.partner" },
    "android": { "package": "org.bugsha.partner" },
    "plugins": [
      "expo-router", "expo-secure-store", "expo-sqlite",
      "expo-camera", "expo-notifications", "expo-localization",
      ["expo-build-properties", { "ios": { "useFrameworks": "static" } }]
    ],
    "extra": { "eas": { "projectId": "…" } }
  }
}
```

EAS Build for both platforms; EAS Update for JS-only fixes. **Never** ship a payment or ledger change over EAS Update without a store build — a mismatch between client expectations and server ledger behaviour is exactly the class of bug that costs money.

## 2. RTL — get this right on day one

```ts
// apps/*/src/app/_layout.tsx
import { I18nManager } from 'react-native';
I18nManager.allowRTL(true);
I18nManager.forceRTL(locale.startsWith('ar'));
```

Changing direction requires a **reload** on both platforms. The language screen (`S-C-002`) is designed for this: selecting a language re-lays out the app, and a brief reload there is acceptable because it happens once, before any account exists. Changing language later from settings shows a "restarting" state.

**Use logical properties everywhere.** `marginStart`, `paddingEnd`, `start`, `end`. Never `left`/`right`, never `marginLeft`. A lint rule (`react-native/no-raw-directional-styles`, custom) fails the build on physical directions outside the tokens package.

Icon mirroring per the table in `11-i18n.md §5`, driven by a `mirror` prop on the `Icon` component from the design system — already implemented there. Do not re-solve it.

## 3. Offline — the partner app's defining constraint

Redemption **must** complete with no network. This is not a degraded mode; it is the normal condition of a basement kitchen at 22:45.

### Local mirror

`expo-sqlite`, written by a sync worker, read by the UI.

```sql
-- apps/partner/src/offline/schema.sql
create table cached_order (
  order_id text primary key, code text not null, code_hash text not null,
  customer_first_name text, quantity integer,
  window_start_utc text, window_end_utc text,
  method text, amount_due_minor integer, currency text,
  status text, store_id text, synced_at text
);
create table mutation_queue (
  client_id text primary key,        -- uuidv4, becomes the Idempotency-Key
  operation text not null, payload text not null,
  client_ts text not null, attempts integer default 0,
  last_error text, created_at text
);
create table sync_state (key text primary key, value text);
```

Cached scope: **the current and next window's orders** for every assigned store. Nothing older, nothing further out — the mirror stays small enough to sync in seconds on 3G.

### Redemption while offline

```
1  staff enters or scans the code
2  validate against cached_order (compare code_hash, check window state)
3  write the local mirror: status = 'redeemed'
4  insert mutation_queue { client_id: uuidv4(), operation: 'redeem_order',
                           payload: { orderId, mechanism, staffUserId },
                           client_ts: new Date().toISOString() }
5  show CONFIRMED to the staff member IMMEDIATELY — no spinner, no "pending"
6  on reconnect: POST each queue row with Idempotency-Key = client_id
7  server records client_ts AND server_ts in the compliance ledger
```

Step 5 is the requirement. A staff member holding a bag needs a yes or a no, now. A "pending" state produces a second hand-over.

### Conflict resolution

| Conflict | Resolution |
|---|---|
| Already redeemed server-side | Earliest wins. Non-blocking notice naming who took it. No error |
| Order cancelled online while offline | **Order is honoured** — the bag was handed over in good faith. Refund reversed into partner revenue. Ops sees the exception. **Staff are never blamed** (`§13.6`) |
| Staff member revoked while queue pending | Queued redemptions remain valid and **attributed to them**. Revocation never rewrites history (`§13.15`) |

### Reservation pause

While a store's partner device is offline beyond a threshold, `app.pause_store_reservations(store_id, 'device_offline')` stops new reservations for that store. Nobody buys a bag the store cannot see. Resumes automatically on reconnect.

### What is *not* cached

Money, payouts, analytics, ledger. If it needs a network, it says so and disables the control — never a silent failure (`S-C-060`).

## 4. Consumer offline

Lighter, but two hard requirements:

1. **The redemption code renders from cache with no signal** (`S-C-041`). Store it in `expo-secure-store` for any order in `reserved`.
2. Cached browse content stays visible and is **marked possibly stale** with the fetch time. Actions needing a network are disabled with an explanation.

## 5. Push notifications

`expo-notifications` → Expo Push → APNs / FCM. Tokens registered per device in a `device_token` table keyed by `app_user`.

```
send-notification Edge Function:
  1  resolve the recipient's locale from app_user.locale
  2  load notification_template (key, locale, published = true)
  3  interpolate; apply numerals per app_user.numerals
  4  check notification_preference: category enabled? quiet hours?
     → unless template.bypasses_quiet_hours
  5  dispatch per channel; write notification_log with per-channel results
```

**Bypasses quiet hours** — consumer: none. Partner: unredeemed orders at close, payout failure, document expiry, quality flag raised. Nothing else, ever.

Per-market channel strategy (`market_config`, `TODO(decision)` on the providers):

| Market | Strategy |
|---|---|
| KW | Push primary. SMS in **parallel** for pickup reminders and order confirmations. |
| EG | Push + SMS **together** for pickup reminders — Egyptian SMS delivery is the weakest channel, so it is a parallel send, not a fallback. WhatsApp for partner-critical. |

Deep links: `bugsha://order/:id`, `bugsha://redeem/:id`, `bugsha://store/:id`, `bugsha://browse`, `bugsha://wallet`. Every one of the 14 consumer templates has a target — see `S-C-065`.

**Permission timing:** deferred until after the first successful reservation (`S-C-008`), with the early placement also built. The primer previews the actual categories as real toggles so granting is not a blank cheque.

## 6. Camera and scanning

`expo-camera` with `CameraView` barcode scanning for QR redemption, both directions:

- **Consumer scans the partner's QR** (`S-C-041`) — the store displays a QR encoding `store_id` + a rotating short-lived token. Token rotation prevents screenshot reuse; validity window is generous enough to tolerate an offline partner device.
- **Partner scans the consumer's code** (`S-P-017`) — plus a manual entry fallback with fuzzy matching on the restricted alphabet.

Manual entry is **always** available in both directions. A cracked camera or a dark counter cannot block a hand-over.

## 7. Secure storage

| Data | Store |
|---|---|
| Session tokens | `expo-secure-store` |
| Redemption codes for active orders | `expo-secure-store` |
| Cached orders board, mutation queue | `expo-sqlite` (device-encrypted at OS level) |
| Locale, numerals, market, active shift | `AsyncStorage` |

**Never** a PSP key, provider secret or service-role key in the client. The client's only payment interaction is opening a URL the server returned.

## 8. Tablet layouts — partner only

The orders board is the reason tablet support exists (`S-P-016`). It stands on a counter for a whole shift.

```ts
// apps/partner/src/features/orders/OrdersBoard.tsx
const { width } = useWindowDimensions();
const layout = width >= 900 ? 'tablet' : 'phone';
```

Tablet-specific requirements:

- `expo-keep-awake` active while the board is open. The screen must not sleep mid-shift.
- Session persists a full shift without re-auth (`market_config`, shortest for `owner`).
- Audible new-order announcement, configurable.
- The shift selector (`app.set_active_shift`) puts a real name on every redemption **without** a re-auth — a shared tablet is the real operational pattern, and pretending each staff member logs in produces useless audit data.
- Code column set in mono at ≥ 22px, readable across a counter.

## 9. Apple — what is needed

> Account type is still unconfirmed. See `13-config.md §4`.

| Item | Requirement |
|---|---|
| Account type | **Organization** is needed if partner staff at other businesses will install the partner app, and for Apple Pay merchant certificates. Individual works for the consumer app alone. |
| Bundle IDs | `org.bugsha.consumer`, `org.bugsha.partner` — reserve both |
| Apple Pay | Merchant ID + payment processing certificate, issued through the PSP (MyFatoorah or Tap). Kuwait only at launch |
| Push | APNs key (p8), one per app |
| Sign in with Apple | Required, since third-party sign-in is offered (`S-C-010`) |
| TestFlight | Internal for the team; external groups for pilot partner staff |
| App Store availability | Kuwait and Egypt storefronts |

### Review notes to prepare

Anticipate these, because they will be asked:

1. **A demo account per app** with seeded data — a consumer with an active reservation, and a partner with a live listing and orders on the board.
2. **Explain the model** in the review notes: this is prepaid in-app, collected in person, and there is no delivery. Reviewers reach for a delivery mental model and then ask why there is no tracking.
3. **Cash on pickup** is Egypt-only and is a reservation, not an in-app purchase. Say so explicitly.
4. **Location** usage string must be honest and specific: distance and drive-time sorting, never required to use the app.
5. **Camera** usage string: scanning a pickup code at the counter.
6. Nothing sold in-app is digital content, so **StoreKit does not apply** — the goods are physical food collected in person. Have this sentence ready.

## 10. Android

- Play Console: two apps, same bundle IDs as package names.
- `POST_NOTIFICATIONS` runtime permission on Android 13+ — request at the same deferred moment as iOS.
- Data safety form: location (optional, not required), camera, phone number, payment info handled by a third-party processor.
- **Cold start to the partner Today view: ≤ 3 s on a mid-range Android on 3G.** This is a measured contract (`12-test-plan.md §performance`), and it is the constraint that rules out a heavy splash or a blocking config fetch.

## 11. Build and release

| Channel | Purpose |
|---|---|
| `development` | Local dev client |
| `preview` | Internal TestFlight / Play internal testing, staging Supabase |
| `production` | Store releases, prod Supabase |

Secrets via EAS secrets, per channel. **No `.env` committed, ever.**

Release gates:

- All pgTAP tests green, including `§ledger L24`.
- Copy lint clean; every locale key present.
- The `§13` Maestro suite green on a real device, with airplane-mode redemption.
- `dst_integrity_check` run manually against the staging Egypt fixture before any release within 14 days of a transition.

## 12. Minimum-version enforcement

`app.bootstrap()` returns `min_supported_version`. Below it, the client shows the forced-update screen (`S-C-061`) and blocks. Use it when a payment or ledger contract changes — never for a cosmetic release.
