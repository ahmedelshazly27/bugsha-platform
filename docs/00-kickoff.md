# Kick-off — paste this as your first message to Claude Code

Run Claude Code from an **empty folder** on your machine. Paste this verbatim.

---

Read `docs/CLAUDE.md` end to end before doing anything else, then `docs/00-product.md`, `docs/01-architecture.md`, `docs/02-data-model.md` and `docs/05-money.md`.

This is Bugsha — a surplus-food marketplace launching in Kuwait and Egypt at the same time. Expo/React Native apps, Supabase only, no separate backend service. The `docs/` folder is an exhaustive specification: where it states a value, use it; where it says `TODO(decision)`, build the interface, leave the value null, and make the code raise rather than default.

Do this, in order:

1. Create a private GitHub repo called `bugsha` on my account and initialise the monorepo layout from `docs/01-architecture.md §2`.
2. Run `/design-sync` to bind the Bugsha design system so `packages/tokens` and `packages/ui` come from the real source, not from your reading of a screenshot.
3. Start **phase 1 only** from the build order in `docs/CLAUDE.md`: schema, RLS, seed. Apply `docs/03-schema.sql` and `docs/04-rls.sql` as numbered migrations, then build the fixture set from `docs/12-test-plan.md §fixtures` and make the 15 RLS tests and the ledger tests pass with pgTAP.

Stop when phase 1 is green and show me the test output. Do not start on screens.

Three things to hold on to while you work:

- The ledger shapes the schema. Do not implement money as computed reports over the orders table.
- Commission is stamped on the order at creation from the contract version in force, and never recomputed.
- Redemption must complete with no network, and redeeming an already-redeemed order returns success with the original record — never an error a staff member could read as "try again".

If the spec is silent on a product question, ask me. If it is silent on a technical one, decide, implement, and append a row to `docs/DECISIONS.md`.

---

## What you need in the folder first

| Path | Why |
|---|---|
| `docs/` | The specification |
| `ui_kits/consumer/`, `ui_kits/partner-platform/`, `ui_kits/ops-console/` | 188 screens, the frame codes `docs/09-screens.md` references |
| `components/`, `tokens/`, `styles.css` | Design-system source, if you are not using `/design-sync` |

`/design-sync` is the better route for the design system — it keeps `packages/tokens` and `packages/ui` in step with this project instead of freezing a copy.

## Then, phase by phase

Each phase is one session. Start it the same way:

> Phase `N` from the build order in `docs/CLAUDE.md`. Read the documents that phase's row points at, and the matching section of `docs/09-screens.md`. Stop when its done-when condition is met and show me.

Do not let a session span phases. Phase 5 (money core) is the one that must not be rushed or reordered — everything after it assumes the ledger is correct.

## Before phase 6

Payments need real sandbox credentials: MyFatoorah and Tap for Kuwait, Paymob for Egypt. Everything up to phase 5 runs on fixtures.

## Before any launch

The six items in `docs/13-config.md §4`, and the `TODO(decision)` answers in the order they block: 1, 3, 5, 6, 7, 11.
