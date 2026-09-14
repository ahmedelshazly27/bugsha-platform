# 09 — Screen data contracts

Every frame in the three catalogues maps to its reads, mutations, states and rules. Frame codes are the join key: open `ui_kits/consumer/`, `ui_kits/partner-platform/` or `ui_kits/ops-console/` and find the code.

**How to read a row:** implement the reads as react-query hooks in `packages/api`, the mutations as RPC calls with an idempotency key, and the states as explicit UI branches. A state listed here is a screen you must build, not a variant you may skip.

Universal states, required on every consumer screen: `default · loading · skeleton · empty · error · offline · RTL · dark · largest dynamic type`.

---

## Consumer — first run and account

| Frame | Screen | Reads | Mutations | Notes |
|---|---|---|---|---|
| `S-C-001` | Splash | `app.bootstrap()` → session, remote config, detected market | — | 3 s → determinate bar; 8 s → "still working" + retry; failure → offline variant |
| `S-C-002` | Language | — | `app.set_locale` | Sets direction, numerals, type family immediately. Usable before an account exists. |
| `S-C-003` | Market | `market_config` | `app.set_market` | Detected pre-selected, always overridable. Changing later → confirmation: cards and wallet are per market. |
| `S-C-004` | City | `city where market = :m` grouped by governorate | `app.set_city` | `stage <> 'live'` routes to `S-C-005` |
| `S-C-005` | Waitlist | — | `app.join_waitlist(contact)` | Offers read-only browse of a live city |
| `S-C-006` | Onboarding | — | — | Panel 2 is non-negotiable: **surplus, not expired**, with the regulator named from `market_config.regulator_name` |
| `S-C-007` | Location primer | — | — | Four permission outcomes: granted, denied, denied-permanently (→ OS settings), services off |
| `S-C-008` | Notification primer | `notification_preference` | `app.set_notification_prefs` | Deferred until after the first reservation; both placements built |
| `S-C-010`–`013` | Auth | — | Supabase Auth: phone OTP, email, Apple, Google | OTP: expired, incorrect, too many attempts, SMS not received (voice fallback), lockout |
| `S-C-014` | Profile | — | `app.complete_profile` | Only first name required, and it says why: the store needs it at pickup |
| `S-C-015` | Dietary | — | `app.set_dietary` | Allergy selection requires `allergen_ack`. Hard gate. |
| `S-C-016` | Account hub | `app.account_summary()` | — | Wallet, no-show count and impact all surfaced honestly |
| `S-C-017` | Delete account | `app.deletion_eligibility()` | `app.request_deletion` | Pending orders **block**; wallet balance forfeited, amount stated; pause-notifications offered instead |

## Consumer — discovery

| Frame | Screen | Reads | Mutations | Notes |
|---|---|---|---|---|
| `S-C-020` | **Browse** | `v_browse_listing` filtered + sorted; sections from `app.browse_sections(market, city, lat, lng)` | `app.toggle_saved_store` | Sections: collect within the hour · new partners · from your saved · nearly sold out · best value. Empty states: <3 results, zero, far-only, all sold out, end of day |
| `S-C-021` | Bag card | — | — | Store name to 40 Latin / 30 Arabic chars; price string 4–12 chars without reflow; at max type size **reflow, never truncate** price or window |
| `S-C-022` | Map | `app.browse_nearby(lat, lng, radius, filters)` | — | Clustered pins with counts; pin states available / low / sold out / saved / selected; "search this area" after pan; dense-cluster case for central Cairo |
| `S-C-023` | Search | `app.search_listings(q, market, city)` | — | Diacritic- and hamza-insensitive. Recent, suggested, trending. Zero-result → nearby + notify-me |
| `S-C-024` | Filters | `app.filter_count(filters)` live | `app.save_filters` | Persist between sessions; active-filter badge on browse. Egypt adds payment-method-accepted |
| `S-C-025` | Store profile | `app.store_profile(store_id)` | `app.toggle_saved_store` | Handles: no bags today, paused, permanently closed |
| `S-C-026` | Category | `v_browse_listing where category = :c` | — | Category-specific explanatory header |
| `S-C-027` | Saved | `app.saved_stores()` | `app.set_store_alert` | Per-store notification toggle |
| `S-C-028` | Campaign | `app.campaign(key)` | — | Reusable template; **Ramadan** is the worked example: iftar/suhoor windows, Hijri secondary line, iftar-surplus category |

## Consumer — reservation and payment

| Frame | Screen | Reads | Mutations | Notes |
|---|---|---|---|---|
| `S-C-030` | Bag detail | `app.listing_detail(id)` | `app.hold_listing` | States: available, low stock, sold out, window not open, window closed, store paused, already reserved, cap reached |
| `S-C-031` | Quantity | `app.quantity_cap(listing_id)` | — | Stepper max from the cap; explains the reason at the ceiling, not after |
| `S-C-032` | Checkout | `app.checkout_summary(order_id)`, `market_config.payment_methods` | `app.apply_promotion`, `create-payment` | KW: KNET default and most prominent. EG: five methods, **cash second, same weight**. Tax line per market. |
| `S-C-032` | Cash confirm | — | `app.reserve_cash_order` | Amount to bring, exact-change note, no-show consequence, lower cap — stated once |
| `S-C-032` | Fawry | `payment.fawry_reference`, `fawry_expires_at` | — | Reference, countdown, instructions; hold = reference lifetime, not the 10-min default |
| `S-C-033` | Payment methods | `app.payment_methods()` | `app.add_card`, `app.set_default` | States that methods are not shared across markets |
| `S-C-034` | Processing | `app.payment_status(order_id)` poll | `confirm-payment` | Blocking. "Don't close the app." |
| `S-C-034` | **Ambiguous** | same | — | **No retry control.** Reconciliation copy. See `06-payments.md §2`. |
| `S-C-035` | Confirmed | `app.order_detail(id)` | `app.add_to_calendar` | Code prominent, countdown to open, directions, what to bring (incl. cash for EG cash orders) |
| `S-C-036` | Failure | `payment.failure_code` | — | Declined, insufficient funds, expired card, 3DS failed, redirect cancelled, network, **sold out mid-payment** (guaranteed no charge + alternatives inline) |

## Consumer — fulfilment

| Frame | Screen | Reads | Mutations | Notes |
|---|---|---|---|---|
| `S-C-040` | Active reservation | `app.order_detail(id)` | `app.cancel_order`, `app.contact_store` | States: window not open, open, last 30 min (escalated, not alarming), closed unredeemed, cancelled, refunded |
| `S-C-041` | **Redemption** | `app.order_detail(id)` + **local cache** | `app.mark_collected` (fallback) | White ground, mono code at 58px, readable at arm's length in sunlight. **Code renders offline from cache.** Both mechanisms built: consumer-shows-code and consumer-scans-QR. Swipe-to-confirm with a "only in front of staff" warning and a 60 s undo. Reader order: code → quantity → window close → action. Countdown announced at 30/10/5 min only. |
| `S-C-042` | Collected | `app.my_impact()` | `app.submit_review` | Small celebration, restrained animation |
| `S-C-043` | Cancellation | `app.refund_preview(order_id)` | `app.cancel_order` | Refund amount, method and timing **stated per market and method** before confirming; reason required |
| `S-C-044` | No-show | `app.order_detail(id)` | `app.open_dispute` | States policy plainly, shows the count honestly, not punitive in tone |
| `S-C-045` | Review | `app.review_eligibility(order_id)` | `app.submit_review`, `app.open_dispute` | Redeemed only. **Quality/safety route is visually distinct** and goes to priority support, not a public review |
| `S-C-046` | Dispute | `reason_code where domain = 'dispute'` | `app.open_dispute` | Distinct fast path for suspected illness capturing items, time eaten, onset, symptoms; states we will contact directly |
| `S-C-047` | Refund status | `app.refund_timeline(refund_id)` | — | Requested → approved → processing → completed with method-specific expectations |

## Consumer — retention, help, system

| Frame | Screen | Reads | Mutations |
|---|---|---|---|
| `S-C-050`–`051` | History, receipt | `app.orders()`, `app.receipt(order_id)` | `generate-document` |
| `S-C-052` | Impact | `app.my_impact()` | — · money is the hero; environmental figure secondary with a methodology link |
| `S-C-053` | Wallet | `app.wallet_balance()`, `wallet_transaction` | — · expiry rules stated plainly |
| `S-C-054` | Referral | `app.referral_status()` | `app.share_referral` |
| `S-C-055` | Notifications | `notification_preference` | `app.set_notification_prefs` · order updates non-optional **and explained**; quiet hours; per-market SMS vs push |
| `S-C-056` | Help | `app.help_articles(locale)` | — · WhatsApp route mandatory in both markets |
| `S-C-057` | **Food safety** | `market_config.regulator_name` | — · trust asset, designed with the same care as browse |
| `S-C-058` | Legal | `app.legal_documents(market, locale)` | — · per market, with last-updated dates |
| `S-C-060` | Offline | local cache | — · cached content visible and marked possibly stale; **redemption codes remain available**; network actions disabled with an explanation, never silent failure |
| `S-C-061`–`063` | Update, maintenance, out of area | `app.bootstrap()` | — |
| `S-C-064` | Restricted | `app.restriction_detail()` | `app.appeal_restriction` · reason, count, end date and appeal route on one screen |
| `S-C-065` | Push catalogue | `notification_template` | — · 14 templates × 3 locales, each with a deep-link target |

---

## Partner

| Frame | Screen | Reads | Mutations | Contract |
|---|---|---|---|---|
| `S-P-000` | Join Bugsha as a partner (`/join`) | — | — | Two paths: *I have a partner code* / *Request a partner code*. Reachable signed-out. Staff of an existing partner are invited by their owner instead |
| `S-P-001` | Enter your partner code (`/join/code`, deep link `bugsha-partner://signup?code=`) | `app.check_partner_code` | — | Invalid / expired / used / withdrawn each get their own copy and next step; a live code pre-fills the application |
| `S-P-002` | Application (`/join/apply`) | `app.cities_for` | `app.submit_application(code, …)` | Pre-filled legal + trading name from the code; the code is consumed on submit; lands on the setup checklist |
| `S-P-004` | Request a partner code (`/join/request`) | `app.cities_for` | Edge `partner-request` | Same form as bugsha.app/partners; ops issues the code from the console and the database emails it |
| `S-P-003` | KYB documents | `market_document_requirement`, `partner_document` | `app.upload_document` | Market-configured set. Capture, preview, retake, validation, per-document status |
| `S-P-004` | Contract | `partner_contract` | `app.accept_contract` | Records timestamp, IP, device, user, document hash |
| `S-P-005` | Store setup | — | `app.upsert_store`, `app.set_hours` | Pin authoritative; pickup point required in **both** languages with worked examples; split shifts; separate Ramadan schedule |
| `S-P-006` | Template | — | `app.upsert_bag_template` | Price ≤ 50% of min value, error names the ceiling; alcohol rejected |
| `S-P-007`–`008` | Checklist, training | `app.onboarding_checklist()` | — | Training re-openable from More |
| `S-P-010` | **Today** | `app.today(store_id)` | — | Priority order fixed: next-window countdown → live listings → money. Alerts: unredeemed at close, expiring window with unsold stock, document expiry, payout failure, quality flag, low rating |
| `S-P-011` | **Fast publish** | `app.templates(partner_id)` | `app.publish_listing` | **≤ 15 s, ≤ 3 taps, ≤ 3 API calls.** No price field in this path. Live consumer preview. |
| `S-P-012` | Full publish | — | `app.publish_listing` | All template fields + scheduling |
| `S-P-013` | Schedules | `app.schedules(store_id)` | `app.upsert_schedule`, `app.pause_schedule` | Holiday suppression; **Ramadan suspension with a suggested iftar/suhoor pair** |
| `S-P-014` | Listings | `app.listings(...)` | `app.update_listing` | Quantity up always; down only to units sold (`BG114` names the count); price frozen after first sale (`BG115`) |
| `S-P-015` | Cancel listing | `app.cancel_preview(listing_id)` | `app.cancel_listing` | Shows affected orders, refund total, notification and reliability impact **before** confirming. `quality_concern` writes a flag and explicitly does not count against the partner |
| `S-P-016` | **Orders board** | `app.orders_board(store_id)` + Realtime | — | ≤ 2 s p95. Counter-tablet persistent; audible new-order option; cash rows distinguished with amount due; search by code fragment, name or scan; renders at 0 and 200 orders and **offline from cache** |
| `S-P-017` | Redeem | `app.lookup_order(store_id, fragment)` | `app.redeem_order` | Restricted alphabet; fuzzy match; both mechanisms; **already-redeemed returns success naming who took it**; 120 s undo |
| `S-P-018` | Cash collection | `app.cash_due(order_id)` | `app.collect_cash` | Amount due, change guidance, shortfall paths (`§13.10`) |
| `S-P-019` | No-show | `app.no_shows(store_id, date)` | `app.mark_no_show` | Disposition in one tap → compliance ledger + impact |
| `S-P-020` | End of day | `app.end_of_day(store_id, date)` | `app.upsert_schedule` | Listed/sold/collected/no-show/cancelled, gross, commission, net, cash vs digital, sell-through, rating; one-tap schedule tomorrow |
| `S-P-030` | Analytics | `app.analytics_summary`, `app.analytics_insights` | — | Insights are prescriptive and **cite their evidence** |
| `S-P-031` | Payouts | `app.payouts`, `app.payout_detail` | — | Composition line by line; any number to its orders in **≤ 2 taps** |
| `S-P-032` | Statements | `app.statements(partner_id)` | `generate-document` | PDF for filing + CSV reconciling line for line; accountant role reaches it without an owner login |
| `S-P-033` | Compliance ledger | `app.compliance_ledger(store_id, from, to)` | `generate-document` | Category, quantity, declared value, listed time, window, redemption time, staff. Must look like an artifact a regulator would accept |
| `S-P-034`–`035` | Store settings, branch switcher | `app.my_stores()` | `app.pause_store` | Pause blocks new listings and reservations, **does not cancel existing orders**, and says so |
| `S-P-036` | Staff & roles | `staff_assignment` | `app.invite_staff`, `app.revoke_staff` | Permission matrix displayed; manager may manage `staff` only; revocation immediate; **queued offline redemptions stay attributed and valid** |
| `S-P-037` | Reviews | `app.reviews(store_id)` | `app.respond_to_review`, `app.acknowledge_flag` | Quality flags a separate prioritised channel with a required acknowledgement |
| `S-P-038` | Notifications | `notification_preference` | `app.set_notification_prefs` | Operationally critical categories bypass quiet hours and say which |
| `S-P-039` | Support | `app.support_tickets()` | `app.open_ticket` | Response commitment stated **per channel**; account manager route |
| `§11.1` | API access | `partner_api_key`, `partner_webhook_delivery` | `app.create_api_key`, `app.upsert_webhook` | Key shown once; scopes; per-key rate limit; replay pending deliveries |
| `§13.*` | Edge cases | see `12-test-plan.md §13` | | Late redemption, offline conflict, DST, cash shortfall, staff removed, network loss |

---

## Ops

| Frame | Screen | Reads | Mutations | Role |
|---|---|---|---|---|
| `§3.1` | Application queue | `app.ops_partners({status, sla})` | `app.ops_approve_partner`, `app.ops_reject_partner` | ops_manager |
| `§3.2` | Document verification | `app.ops_partner_detail(id)` | `app.ops_verify_document` | compliance — rejection text sent **verbatim**; approval blocked until the market checklist is complete |
| `§3.4` | Partner detail | `app.ops_partner_detail(id)` | `app.ops_suspend_partner`, `app.ops_set_commission` | ops_manager — suspension asks whether existing orders are honoured; commission writes a **new contract version**; both four-eyed |
| `§3.5` | Health queue | `app.ops_partner_health()` | `app.ops_assign_task` | ops_manager — listing decline sorts first |
| `§3.6` | Funnel | `app.ops_onboarding_funnel(from, to)` | — | ops_manager |
| `§4.1` | Live ops | `app.ops_live_dashboard(market)` + Realtime | — | any |
| `§4.2` | Supply/demand | `app.ops_supply_demand(...)` | `app.ops_create_acquisition_list` | ops_manager — output is a ranked list, not a heat map |
| `§4.3` | Order detail | `app.ops_order_detail(id)` | the six interventions | support/ops — each previews its ledger entries before writing |
| `§4.3` | Force cancel | `app.ops_refund_preview(order_id)` | `app.ops_force_cancel` | support — `cost_bearer` explicit; **defaults to platform goodwill on platform failure**; refund cap enforced |
| `§4.4` | Listing moderation | `app.ops_moderation_queue()` | `app.ops_moderate_listing` | ops_manager — editing notifies the partner with what changed and why |
| `§4.6` | Consumer detail | `app.ops_user_detail(id)` | `app.ops_issue_credit`, `app.ops_restrict_user` | support — PII unmask logged and alerted |
| `§5.1` | Dispute queue | `app.ops_disputes(filters)` | `app.ops_assign_dispute`, `app.ops_resolve_dispute` | any — severity decides SLA, owner and whether the partner is asked at all |
| `§5.1` | Illness case | `app.ops_dispute_detail(id)` | `app.ops_place_quality_hold`, `app.ops_open_incident` | compliance — partner informed, **never asked to triage**; welfare checks to same-window orders |
| `§5.2` | Incident register | `app.ops_incidents(filters)` | `app.ops_close_incident`, `app.ops_amend_incident`, `generate-document` | compliance — immutable once closed; formal PDF export; linked to compliance ledger rows |
| `§5.3` | Quality hold | `app.ops_store_detail(id)` | `app.ops_place_quality_hold` | compliance — blocks listings, spares sold orders unless explicitly told otherwise |
| `§7.1` | Ledger explorer | `app.ops_ledger`, `app.ops_ledger_transaction` | — | finance — debits, credits, zero delta shown |
| `§7.5` | Payout run | `app.ops_payout_run_detail(id)` | `app.ops_approve_payout_run` | finance — exceptions block approval; negative balance carries, never debits |
| `§7.6` | Reconciliation | `app.ops_reconciliation(kind, ...)` | `app.ops_resolve_exception` | finance — every resolution writes entries and clears suspense |
| `§7.6` | Cash recon (EG) | `app.ops_reconciliation('cash', 'EG')` | `app.ops_assign_task` | finance — persistent variance feeds the health queue |
| `§7.6` | Period close | `app.ops_close_period_checklist(id)` | `app.ops_close_period` | finance — **button disabled, not warning** |
| `§7.7` | Revenue | `app.ops_revenue`, `app.ops_unit_economics` | — | finance — per currency by default |
| `§6.1` | Market config | `app.ops_market_config(market)` | `app.ops_propose_config` | admin — four eyes, versioned, historic rates preserved |
| `§6.4` | Promotion | — | `app.ops_create_promotion` | ops_manager — **rejects without `funded_by`**; models cost both ways |
| `§6.5` | Feature flags | `app.ops_feature_flags(market)` | `app.ops_set_flag` | engineering — kill switches effective ≤ 30 s, logged, alerts on-call |
| `§6.6` | Audit log | `app.ops_audit(filters)` | — | ops/finance/compliance/admin — before/after, reason, session, IP |
| `§8.1` | Jobs & webhooks | `app.ops_jobs()`, `partner_webhook_delivery` | `app.ops_trigger_job`, `app.ops_replay_webhook` | engineering |
| `§8.3` | Notification console | `app.ops_notifications(filters)` | `app.ops_resend_notification` | support |
| `§8.3` | Template review | `app.ops_templates(key)` | `app.ops_review_template` | ops_manager — **publish blocked until all three locales are approved by a non-author** |
| `§8.4` | Impersonation | `app.ops_impersonation_sessions()` | `app.ops_start_impersonation` | support — read-only, non-extendable clock, five named write actions |
| `§8.5` | Warehouse | `bi.*` masked views | `app.ops_request_bulk_export` | engineering — masked by default; > 100 PII rows needs four eyes |
| `§8.6` | Runbook | `app.ops_runbook(key)` | — | engineering — each step states its ledger effect |
| `§10` | Blocking decisions | `app.ops_blocking_decisions()` | `app.ops_update_decision` | admin — the `TODO(decision)` register from `13-config.md`, with owners and dates |

## 2026-09-14 screen pass — what the Expo apps now implement

Every row above has a screen in `apps/consumer`, `apps/partner` or `apps/ops` on branch `claude/partner-code-gate`; the design kits in the bugsha repo (`.claude/skills/bugsha-design/ui_kits/*`) are the visual reference.

- **Consumer** — three-locale language choice; 8-digit email OTP; home bell → notification preferences (categories, quiet hours, channels) and a restriction banner; listing heart + share; promo code, VAT and service fee at pay; every order state (hold countdown, Fawry reference, cash, running late, review with tags, no-show warnings, partner cancellation, refunds, cancel with refund destination); **pickup QR** (`bugsha://redeem/<CODE>`) next to the code; waitlist sign-up; deletion undo; restricted screen.
- **Partner** — join / code / application / request; onboarding status hub with history; **redeem by QR scan or code**, late hand-over past the grace window when online, 60 s undo; schedules; branch pause/resume and branch switching; quality flags acknowledge + dispute replies + quality-hold banner; staff on-shift; commission from the contract.
- **Ops** — live dashboard (KPIs, needs-a-person, funnel, supply vs demand); partners with stage filters; partner detail (documents, contracts + commission, suspend/reinstate, reliability override, reject); orders with detail and the force actions; moderation; disputes (assign, resolve with goodwill/refund/none), incidents, quality holds; users (restrict, credit, impersonate); money (payout runs two-approver flow, execute, confirm, reconciliation, revenue, tax, ledger, CSV); config (propose, flags, cities); notification templates (edit → review → publish, lock-screen preview); audit filters + CSV; jobs.

Not exposed by the platform yet, so not on a screen: `app.ops_refund_preview`, `app.ops_assign_task`, `app.ops_create_acquisition_list`, `app.ops_store_detail`, `app.ops_impersonation_sessions`, `app.ops_close_period_checklist`, a quality-hold list (holds are placed/released from the incident that owns them).
