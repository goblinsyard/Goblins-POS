# Goblins Yard POS — Progress

## Phase 1: Foundation ✅ COMPLETE (2026-06-11)

### Done
- **Monorepo**: pnpm workspaces — `apps/api`, `packages/shared` (POS/backoffice/KDS apps come in Phases 2/4/8)
- **Full Prisma schema** (60+ models, ALL modules designed up front): settings/printers/stations, auth/RBAC/audit, menu/modifiers/combos/price schedules, unified Resource floor model, orders/payments/discounts, time-billing (RatePlan/RateRule/Session/SessionSegment/PrepaidBlock), shifts/cash, KDS tickets, inventory (single StockMovement ledger, batches/FEFO, POs/receiving/counts/waste), recipes + sub-recipes + production orders, costing snapshots, expenses, CRM/loyalty/reservations
- **Money**: integer piasters everywhere. **Time**: UTC storage, Cairo display, DST-aware via Intl
- **`packages/shared`**: pure money math + time-billing engine + Cairo time + permission catalog
  - `priceSession()` walks segments minute-by-minute across rate windows → midnight crossover, happy-hour bands, pauses, transfers, grace, minimum charge, nearest-N rounding all from one algorithm
- **Tests**: 43/43 passing (money: bill totals incl. Egyptian 12% service + 14% VAT, tax-inclusive extraction, 0.5-qty, split-even exactness; time-billing: midnight crossover, happy-hour boundary, paused timers, single/multi PS rates, rounding modes, grace, minimum, wrapping windows, band integrity)
- **API (NestJS)**: global JWT auth guard + `@RequirePermissions()` RBAC, PIN login for POS, refresh-token rotation (hashed, revocable), manager-PIN approval helper for gated actions, audit service (tx-aware), settings service with defaults, Socket.IO gateway (rooms: floor/kds:*/expo/menu/pos), throttling
- **Docker**: compose with Postgres 16 (host port **5433** — native PG occupies 5432), API Dockerfile with auto-migrate + auto-seed; web/print-service entries staged (commented) until their phases
- **Seed**: roles w/ permission matrix, 6 staff (PINs: Owner 9999, Manager 1111, Cashier 2222, Waiter 3333, Kitchen 4444, Bar 5555; back office owner@goblinsyard.com / admin123), 6 restaurant tables + 4 billiards + 3 PS rooms with floor geometry, 20 menu items (EN+AR) with recipes, 3 sub-recipes (mojito base 2L, pizza dough ×10, red sauce 3L) consumed as intermediates, modifiers, happy-hour price schedule + billiards happy-hour rate rule, billiards 120 EGP/hr (min 30), PS 80/120 single/multi (min 20), 3 suppliers + price history, 3 loyalty tiers (Goblin → Hobgoblin → Goblin King), 5 customers, **293 orders + 59 sessions over 14 days**, expense categories, sample reservation

### Verified (live, not just compiles)
- Migration applied; seed counts confirmed via SQL
- Owner password login → 37 perms; audit endpoint accessible
- Waiter PIN login → 6 perms; audit endpoint **403 Forbidden** (RBAC works)
- Wrong PIN rejected; refresh rotation works; old refresh token rejected after rotation

### Decisions
- Native PostgreSQL on this machine occupies 5432 → container maps to **5433** for local dev (inside compose network it's still 5432)
- Session pricing: minute is the billing quantum; rounding delta applied to the last band so bands always sum exactly to the bill
- Sub-recipes are modeled as intermediate `Ingredient` rows produced by a `Recipe` with `outputIngredientId` — recipe lines can reference them, so sale-deduction walks one tree
- Rate-rule windows may wrap midnight; a wrapped window belongs to its start day

## Phase 2: POS core ✅ + Phase 3: Time-based billing ✅ (2026-06-11)

### Done
- **Orders module**: create (requires open shift), add items w/ modifiers + price-schedule pricing + 86 enforcement, void item/order (audited, manager-PIN approvable), discounts (percent/fixed, item/bill level, mandatory reason codes), split-by-items, merge orders, transfer between tables — all money recomputed server-side via shared `computeBill` inside transactions
- **Payments**: multi-method split payment, cash tendered/change, overpayment rejection, drawer-open flag, refunds (gated + audited), loyalty earn + tier auto-upgrade on close, resource freed → NEEDS_CLEANING
- **Shifts**: open w/ float, X report, Z report (blind count, frozen JSON snapshot, variance), cash movements (paid in/out, petty cash, no-sale drawer open — audited), close blocked while orders open
- **Receipts**: 42-col text renderer (header/tax-id/footer from settings) — ESC/POS-ready, print-preview in POS
- **Sessions (Phase 3)**: start/pause/resume/stop, mode switch single↔multi mid-session (segment split), transfer between same-type resources preserving elapsed time, live cost endpoint, stop freezes time-charge line onto combined bill, prepaid blocks (priced at current rate, offset final charge, near-expiry WS alert via 30s cron), session history via audit
- **POS app (React)**: PIN tile login, EN/AR with RTL, floor plan with live status colors + live session costs (client-side `priceSession` ticking), touch order screen (categories→items→modifier dialog with min/max rules), cart with void/discount/notes, split-method pay dialog with change, receipt preview + print, shift open/close/X-report dialogs, session timer strip (start/pause/resume/stop/mode/prepaid display)

### Verified live
- **Phase 2 script — 15/15**: hand-calculated bill math (520 → 12% svc → 14% VAT = 663.94 EGP), 10% discount recompute, split bill, cash w/ change 34.02, mixed cash+card, receipt render, void flows, no-sale drawer, X/Z with zero variance, all 8 privileged actions in audit log
- **Phase 3 script — 15/15**: live cost, pause/resume, transfer preserving time, F&B attached to session, combined bill w/ minimum charge (30 EGP), PS multi→single mode switch, prepaid 60min=80EGP at single rate, prepaid fully offsetting time charge, audit trail
- POS UI serves on :5173, Vite proxy to API works, production build clean

### Bugs found & fixed
- **Minimum charge skipped when rounding→0 minutes**: 1-min session with round-to-5 billed 0 instead of the 30 EGP minimum. Minimum now applies whenever rawMinutes > 0. Regression test added (44 shared tests now)
- Shared package needed a CJS dist build for the Node API; Vite apps alias to TS source for ESM tree-shaking

## Phases 4–8 ✅ (2026-06-11)

### Phase 4 — KDS + printing (13/13 checks)
- Send-to-kitchen groups pending items by (station, course); course 1 → NEW, later → HELD until "fire" — verified held courses hidden from station screens
- Bump lifecycle NEW→IN_PROGRESS→READY→SERVED with timestamps, recall, all-day aggregate, expo view, kdsStatus mirrored to order items
- KDS app: PIN login, station picker, age-colored ticket cards (8/15-min thresholds), keyboard bump bar (1–9), all-day toggle, audio alert on new ticket, WS realtime + poll fallback
- print-service: standalone daemon, ESC/POS builder (init/align/bold/size/cut/drawer-kick), TCP 9100 in live mode, **preview mode writes ticket/receipt .txt files** (verified end-to-end via real WS events: 4 tickets + 1 receipt landed as files); failed live prints fall back to preview so tickets are never lost
- Receipt print job emitted automatically on full payment (with drawer-kick flag)

### Phase 5 — Inventory + manufacturing (15/15 checks)
- Single `StockMovement` ledger (verified all 7 kinds present); StockLevel as maintained cache
- **DoD #3 verified live**: production order (2L mojito base) consumed 120 g mint etc., created +2000 ml intermediate at computed cost; selling a Virgin Mojito consumed −200 ml of the intermediate
- Purchasing: PO → partial receive (30/50) → batch w/ expiry+lot → **moving-average cost** (3500→3636.36 pt verified) → supplier price history; PARTIALLY_RECEIVED status
- Transfers w/ stock checks, waste logs, spot/full counts posting variance as adjustments, FEFO expiring list, low-stock endpoint, manual adjust (gated `stock.adjust` — waiter denied 403)
- Sale → recipe tree walk → deduction at the recipe's deduct location, FEFO batch consumption

### Phase 6 — Costing + expenses (10/10 checks + 2 vitest)
- **DoD #4 verified by test**: Margherita theoretical cost = 36.76 EGP (dough-ball sub-recipe 2.80 + sauce 3.96 + mozzarella 30.00) = 22.98% of 160 EGP — hand-calculated, in `apps/api/test/costing.spec.ts`
- Theoretical vs actual cost summary (actual from SALE_DEDUCTION ledger), menu engineering (Stars/Plowhorses/Puzzles/Dogs — all 4 classes appear on seeded history), nightly cost snapshot cron + margin alerts over WS
- Expenses w/ categories + monthly recurring materialization cron, petty-cash via shift cash movements, **daily P&L by department** (rev − COGS − expenses), VAT report scaffold, CSV-ready
- Seed bug found & fixed: EGP() rounded fractional per-gram costs (flour 1.5 pt/g → 2); seed now stores exact decimals

### Phase 7 — Reservations + CRM + loyalty (11/11 checks + 3 vitest)
- **DoD #5 verified**: overlap blocked (409), boundary-exclusive adjacency allowed, status machine enforced, **no-show auto-release** via 1-min cron sweep (also manual /sweep) — flags resources RESERVED 30 min ahead, frees after grace
- **DoD #6 verified by test** (`apps/api/test/loyalty.spec.ts`): earn on visit 1 (takeaway 285 EGP → 2 pts), redeem on visit 2 as payment credit (2 pts = 2 EGP), over-redeem rejected; tier auto-upgrade on lifetime spend
- CRM: phone-first lookup, profile w/ favorites + visit history, birthday-this-week POS flag, segments (inactive30/top10pct/birthday) + CSV export with message template, feedback capture
- Public unauthenticated availability endpoint (rate-limited) for goblinsyard.com booking widget

### Phase 8 — Reporting + dashboard + back office
- Reports API: owner dashboard (revenue by dept, occupancy, top sellers, food-cost %, labor, expenses), sales by hour/day/department/category/item/method/staff (+CSV), utilization (occupancy %, revenue/available-hour, day×hour peak heatmap), inventory reports (consumption/variance/waste/supplier prices, +CSV) — all date-filterable
- Admin API: menu CRUD + price override (audited as `price.override`), rate-plan editor + happy-hour rules, printer manager w/ test print, station config, staff CRUD + role permission matrix, time clock in/out + payroll hours
- Back-office React app: login, dashboard cards, sales report w/ grouping + CSV download, utilization table + heatmap, P&L + menu engineering + item costs, menu manager (86/restore/price), rate-plan editor, audit log viewer
- Fixed: report date params with unencoded `+` offsets 500'd — defensive date parsing

## Phase 9 — Hardening ✅ COMPLETE (2026-06-11)

## DEFINITION OF DONE — FINAL STATUS

| # | Requirement | Status |
|---|---|---|
| 1 | `docker compose up` brings up everything, auto-seed, README w/ hardware+backup docs | ✅ verified: 4 containers up; POS/admin/KDS served via nginx :8080, API proxied, login + dashboard work through the containerized stack |
| 2 | Full happy path covered by automated E2E test | ✅ `apps/api/test/e2e-happy-path.spec.ts` — 14 steps incl. correct-station routing, sessions, split, mixed payment, stock deduction, exact Z totals |
| 3 | Production order: raw→intermediate→sale consumes intermediate | ✅ verified live (Phase 5 script) AND covered by E2E step 13 |
| 4 | Theoretical food cost % matches hand-calculated example in tests | ✅ `apps/api/test/costing.spec.ts` — Margherita 36.76 EGP = 22.98% |
| 5 | Reservation create / conflict blocked / no-show auto-release | ✅ Phase 7 script: 409 on overlap, boundary-exclusive, cron sweep releases |
| 6 | Loyalty earn + redeem across two visits, verified by test | ✅ `apps/api/test/loyalty.spec.ts` |
| 7 | Money & time-billing unit tests w/ edge cases | ✅ 45 tests: midnight crossover, paused timers, happy-hour boundary, 0.5-qty, rounding modes, grace, minimum w/ rounding-to-zero regression |
| 8 | Privileged actions permission-gated + audited | ✅ RBAC on every endpoint (global guard, default-deny without JWT), verify scripts assert 403s + audit rows for void/discount/refund/drawer/stock-adjust |
| 9 | EN + AR (RTL) on POS and KDS | ✅ POS full i18n dict + RTL dir switching; KDS lang toggle + RTL |
| 10 | No TS errors, lint passes, all tests green, PROGRESS.md current | ✅ typecheck exit 0 (all 6 packages), eslint exit 0, 64/64 tests passing |

### Phase 9 detail

- **DoD #2 E2E test** (`apps/api/test/e2e-happy-path.spec.ts`) — 14 steps, all passing: open shift → seat table → burger w/ extra-cheese modifier + mojitos → tickets on CORRECT stations (burger→Kitchen, mojitos→Bar) → bump to READY → billiards AND PS sessions → colas attached to PS order → stop sessions (minimum charges verified 30/20 EGP) → split bill by items → mixed cash+card payment → receipts render → mojito-base intermediate deducted −400 ml for 2 mojitos → Z report gross exactly equals the sum of paid bills, variance 0
- **All tests green: 45 shared unit + 19 API integration/E2E**
- POS offline queue: IndexedDB-backed, queues order-building POSTs (add items / send-to-kitchen) on network failure, replays in order on reconnect + 20 s interval; money ops intentionally never queued; amber banner shows queued count
- KDS Arabic + RTL toggle (DoD #9 now covers POS and KDS)
- Backup/restore: `scripts/backup.ps1` (zip, keep-30), `scripts/backup.sh` (cron-ready), `scripts/restore.ps1`
- Docker: web image (nginx serving POS / + /admin + /kds, proxying /api + /ws), print-service image (preview volume), api image (auto-migrate + conditional seed); full `docker compose up --build` validation in progress
- README: setup, hardware (printer TCP 9100 + drawer kick), backup/restore, config, phase-2 hooks

## UI Completion Pass (2026-06-11, post-DoD)

Gap audit found ~50 API endpoints with no UI. This pass exposed all of them.

### Back office — restructured + 7 new tabs
- Refactored monolithic `App.tsx` into `src/lib/{api,ui}` + `src/tabs/*` (15 tabs, grouped sidebar: Analytics / Operations / Configuration)
- **Inventory**: stock levels by location w/ transfer/waste/adjust modals, low-stock + expiring alerts, movement history w/ kind filter, full physical counts (start → enter counted → post variances), inventory reports (consumption/variance/waste/prices) + CSV
- **Purchasing**: PO list w/ status badges, create PO (multi-line, last-cost prefill), receive (partial, per-line qty/expiry/invoice), suppliers, production (producible recipes, produce batch w/ labor, log)
- **Customers (CRM)**: phone lookup, full profile modal (favorites, visits, points history, reservations), create/edit, segments (all/inactive30/top10pct/birthday) + CSV export w/ message template
- **Reservations**: 7-day timeline grouped by day, create (resource picker from floor plan, duration, deposit), status machine buttons (confirm/check-in/no-show/cancel/complete), manual sweep
- **Staff**: list, create (role/password/PIN), role permission matrix editor (Owner locked), time-clock hours report
- **Expenses**: 30-day list w/ category filter, create (recurring-monthly support), VAT report w/ month totals
- **Settings**: typed key-value editor (GET/PUT /settings), printers (create + test print), station config (printer assignment, KDS/print routing toggles)
- **Menu** (upgraded): create category + create item (department/station/auto tax), rename; **Rate plans** (upgraded): edit minimum, add/delete time rules w/ day-of-week picker

### POS — order actions, money ops, CRM
- ⋯ Actions menu on order screen: void entire order (reason, perm-gated), split bill by items (navigates to child), merge into another open order, move table (resource picker), refund a payment (reason), fire course
- Course selector (C1–C3) when adding items + course badges on lines; fire-next-course per pending course
- Customer button: phone lookup → attach to order, create-new-customer, POS flags (tier/points/visits/🎂 birthday), redeem points as payment credit, detach
- Post-payment ★ feedback dialog (1–5 + comment → /crm/feedback)
- Floor: 💵 Drawer dialog (paid-in/paid-out/petty-cash/no-sale open, audited), ⏱ time-clock in/out
- Session panel: ⏱+ prepaid minute blocks (30/60/120 presets), ⇄ move session to another resource, prepaid total badge
- i18n: all new strings added in EN + AR

### KDS
- 🖨 reprint button per ticket (`POST /kds/tickets/:id/reprint`)

### API (one addition)
- `POST /orders/:id/customer` — attach/detach CRM customer on an open order (audited, `pos.use`); needed so loyalty earn/flags work for in-flight orders

### Verification
- `pnpm -r typecheck` ✅ (6/6) · `pnpm -r lint` ✅ · shared 44/44 ✅ · API integration+E2E 19/19 ✅ (against compose stack) · POS/KDS/back-office/API builds ✅ · web+api Docker images rebuilt

## Feature Pass 2 + Bug Fixes (2026-06-11, evening)

### Bug fixes
- **KDS monitors going blank**: access tokens expire after 15 min and the KDS never refreshed them — an always-on kitchen/bar screen silently stopped updating (every fetch error was swallowed). KDS now stores the refresh token, auto-refreshes on 401, falls back to the PIN screen when the session is truly dead, shows a visible ⚠ connection banner, and re-syncs on websocket reconnect.
- **Timer lost after moving a table to billiards/PS**: order type now follows the destination table on transfer (DINE_IN ⇄ BILLIARDS ⇄ PS_ROOM; totals-neutral — service charge only differs for takeaway), so the session panel/timer appears. Orders with a live timer transfer via the sessions endpoint so the timer moves too. Guarded: an active session blocks re-typing away.
- **Occupied tables rejecting moves**: ResourcePicker now allows occupied destinations for order moves (amber, shows open-bill total); a table can hold several open bills. Floor shows an order count + combined total and opens a bill chooser (incl. "+ new order") when a table has more than one.

### New features
- **POS seats as tabs**: seat tabs (Table / Seat 1…8) on the cart; items added while a seat is selected are tagged to it; S-badges on lines; per-seat subtotal; one-tap "split this seat to its own bill" → separate receipt per seat. (Also benefits from the multi-bill floor support above.)
- **POS tips**: tip field on every payment line (backend already stored tipCents and sums them in X/Z reports).
- **Back office → Tables**: new tab to create zones and create/edit tables (name AR/EN, type, zone, capacity, shape, rate plan, position/size, active). New API: GET/POST /admin/zones, POST/PATCH /admin/resources.
- **Back office → Recipes**: menu-item recipe editor (lines w/ waste %, yield, deduct location, prep notes, live theoretical-cost preview, "no recipe" warning), manufacturing-process editor for intermediates, ingredient creation (uom, perishable, intermediate, reorder points). New API: /admin/recipes CRUD, /admin/ingredients, /admin/uoms.
- **Customer groups with auto discount**: new CustomerGroup model (+migration `customer_groups`), Customer.groupId. Group discount (bps) auto-applies in order recompute whenever the customer is attached, and clears on detach — verified live (10% → 1800 off 18000). Managed in Back office → Customers; group select on customer create/edit; POS customer card shows the group badge.
- **Receipt logo**: upload/remove in Settings (stored as data URL in settings `receipt.logo`, ≤300 KB), shown on POS receipt dialog + browser print. ESC/POS raster printing noted as future print-service work.

### Verification
- typecheck + lint 6/6 ✅ · shared 44/44 ✅ · API 19/19 ✅ (rebuilt containers) · all builds ✅ · live smoke: group discount attach/detach, transfer retype, zones/recipes/uoms endpoints ✅

## Feature Pass 3 — UX & ops fixes (2026-06-11, late)

### Root causes found for the reported issues
- **KDS "still blank" + "open shift first" while shift open**: API + permissions verified correct for kitchen/bar PIN users (13 live tickets fetched as Hassan). The real culprits were *client-state staleness*: (1) the POS fetched the shift only once at mount, so a shift opened from another tab/terminal left the first one stuck on the "open a shift first" banner with all tables disabled; (2) always-on monitor browsers keep running the *old* JS bundle until manually refreshed, so deployed fixes never reached them. Fixed: POS now polls the shift every 10 s; KDS auto-reloads itself when a new build ships (checks index.html every 5 min); POS Send button now SHOWS errors instead of failing silently; `kds send` now returns a clear error if pending items aren't routed to any station; Menu tab flags "⚠ no station" items and requires a station on creation. **One-time action: hard-refresh (Ctrl+F5) each monitor once.**
- **Tables stuck OCCUPIED after a mis-tap**: tapping a free table creates an order and occupies it. New `POST /orders/:id/abandon` voids an untouched order (no items/payments/session) and frees the table — the POS calls it automatically when you back out of an empty order. Verified live (T5 OCCUPIED → FREE).

### New features
- **Open orders list** (POS): 📋 button on the floor header lists every open bill (number, table, customer, total) — tap to jump in.
- **Overpay → auto tip** (POS): entering more than the amount due is now allowed; the excess is shown and recorded as a tip (plus the explicit tip field). Verified: tips land in the X/Z report.
- **Customer edit from lists** (back office): segment rows now carry ids → "View / Edit" opens the full profile where editing + group assignment already live.
- **Drag-and-drop floor layout** (back office → Tables → layout): drag tables on a visual canvas per zone; position saves on drop (yellow flash); double-click opens the full edit form.
- **Windows one-click start**: `Start Goblins POS.bat` / `Stop Goblins POS.bat` + desktop shortcuts ("Goblins POS", "Stop Goblins POS"). Start handles Docker Desktop boot, waits for the stack, then opens POS/back-office/KDS in the browser.

### Verification
typecheck+lint 6/6 ✅ · API 19/19 ✅ · images rebuilt ✅ · live smoke: abandon frees table, overpay tip recorded (1500 pt in X-report) ✅

### Hotfixes (2026-06-11, latest)
- **Customer picker**: lookup now searches name OR phone (case-insensitive) and an empty query returns regulars first (by visit count) — the POS customer dialog and back-office Customers tab list saved customers immediately and filter live as you type (debounced), no Search button needed.
- **Ghost timer on Billiards 3**: root cause — voiding an order never stopped its session, leaving a RUNNING timer with no order screen to stop it from (order #313 VOIDED, session still RUNNING). Fixed three ways: (1) `voidOrder` now cancels the active session and closes its segments; (2) merging an order with a live timer is blocked with a clear message; (3) new every-minute self-healing sweep (`cancelOrphanedSessions`) cancels any RUNNING/PAUSED session whose order is no longer OPEN and frees the table (audited as `session.orphan_cancelled`). Verified: the stuck session is CANCELLED, Billiards 3 is FREE, zero orphans remain.
- **E2E made rerunnable**: the happy-path test now replenishes mojito-base via a production batch when stock ≤ 200 ml instead of failing on depleted dev data.
