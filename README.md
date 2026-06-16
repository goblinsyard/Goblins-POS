# Goblins Yard — POS + CRM

Full point-of-sale, CRM and back-office system for **Goblins Yard** (Cairo): restaurant & café, billiards lounge (time billing), and PlayStation rooms (time billing, single/multiplayer rates).

## Quick start

```bash
docker compose up --build
```

That brings up everything; demo data seeds automatically on first boot:

| URL | App |
|---|---|
| http://localhost:8080 | **POS** (touch, PIN login) |
| http://localhost:8080/admin | **Back office** (owner/manager) |
| http://localhost:8080/kds | **Kitchen/Bar display** |
| http://localhost:3000/api | REST API |

**Demo logins**

- Back office: `owner@goblinsyard.com` / `admin123` (also `manager@goblinsyard.com`)
- POS / KDS PINs: Owner **9999** · Manager **1111** · Cashier **2222** · Waiter **3333** · Kitchen **4444** · Bar **5555**

Seeded: full menu (EN/AR) with recipes & 3 sub-recipes, 6 restaurant tables + 4 billiards tables + 3 PS rooms, rate plans (billiards 120 EGP/hr, PS 80/120 single/multi — all editable in /admin), suppliers, loyalty tiers (Goblin → Hobgoblin → Goblin King), 5 customers, and **2 weeks of sales history** so reports look real immediately.

## Local development

Requirements: Node 20+, pnpm 9, Docker.

```bash
pnpm install
docker compose up -d db          # Postgres on host port 5433
pnpm --filter @goblins/shared build
pnpm --filter @goblins/api db:migrate
pnpm --filter @goblins/api db:seed
pnpm dev                         # api :3000, pos :5173, kds :5174, backoffice :5175 + print service
```

Tests:

```bash
pnpm --filter @goblins/shared test   # money + time-billing math (45 unit tests)
pnpm --filter @goblins/api test      # integration + full E2E happy path (needs api+db running)
pnpm typecheck && pnpm lint
```

Phase-by-phase verification scripts (PowerShell, run against the dev API): `scripts/verify-phase2.ps1` … `verify-phase7.ps1`.

## Architecture

pnpm monorepo:

```
apps/api            NestJS + Prisma + PostgreSQL + Socket.IO — all business logic
apps/pos            React touch POS (EN/AR RTL, offline order queue via IndexedDB)
apps/backoffice     React admin: dashboard, reports, menu, rate plans, audit
apps/kds            React kitchen/bar/expo screens (bump bar, all-day, EN/AR)
apps/print-service  ESC/POS daemon — TCP 9100 in live mode, file previews otherwise
packages/shared     pure money math + time-billing engine + permission catalog
```

Key invariants:

- **Money is integer piasters everywhere** (EGP × 100). All bill math lives in `packages/shared/src/money.ts` and is unit-tested (Egyptian 12% service + 14% VAT, discounts, splits, tax-inclusive mode).
- **Time billing** (`packages/shared/src/time-billing.ts`): sessions are segment lists (pause/transfer/mode-switch = segment boundaries); pricing walks minutes across rate windows, so midnight crossover, happy hour, grace, minimum charge and nearest-N rounding all come from one tested algorithm. DST-aware via `Africa/Cairo`.
- **Inventory has a single ledger** (`StockMovement`) — receipts, sale deductions (recipe-tree walk incl. sub-recipe intermediates), production, transfers, waste, count adjustments. Stock levels are a cache.
- **Every privileged action** (void, discount, refund, no-sale drawer, price override, stock adjust) is permission-gated (RBAC matrix editable per role) and lands in the audit log with user/approver/terminal.

## Hardware

### Receipt & station printers (ESC/POS)

1. Back office → (admin API) `POST /api/admin/printers` or the Printers screen: add a printer with `connection: NETWORK` and `address: "192.168.1.50:9100"`.
2. Assign it to a station (`PATCH /api/admin/stations/:id` with `printerId`, `usePrinter: true`) — tickets then print in parallel with the KDS screen.
3. Set `PRINT_MODE=live` on the `print-service` container (docker-compose.yml) and restart it.
4. Test with `POST /api/admin/printers/:id/test`.

Without hardware the print service runs in **preview mode** and writes every ticket/receipt to the `print-previews` volume — nothing is lost.

### Cash drawer

Connect the drawer to the receipt printer's RJ-11 port. The drawer-kick command is appended automatically when a cash payment closes a bill (any payment method flagged `opensDrawer`).

## Backup & restore

```powershell
.\scripts\backup.ps1                                  # → backups/goblins-<stamp>.zip (keeps last 30)
.\scripts\restore.ps1 -BackupFile backups\goblins-... # restores (destructive, 5s grace)
```

Linux/macOS: `scripts/backup.sh` (cron-ready). Schedule the PowerShell script via Windows Task Scheduler for nightly backups.

## Configuration

Settings (back office or `PUT /api/settings`): VAT bps, service-charge bps, loyalty earn/redeem rates, no-show grace minutes, receipt header/footer (EN/AR), prepaid alert threshold. Happy-hour pricing: per-menu-item `PriceSchedule`s and per-rate-plan `RateRule`s (day-of-week + time window, may wrap midnight). 86'ing an item pushes live to all POS/KDS over websockets.

## Phase-2 ready

- `GET /api/reservations/public/availability?date=YYYY-MM-DD` — unauthenticated, rate-limited endpoint for the goblinsyard.com booking widget.
- `DELIVERY` order type exists in the schema.
- CRM segment CSV exports (inactive 30d, top 10%, birthdays) with message templates for SMS/WhatsApp campaigns.

See `PROGRESS.md` for the full build log and verification evidence.
