# Goblins Yard POS — Audit Findings (2026-10-19)

Reviewed: latest code (`Goblins-POS/Goblins-POS/Goblins-POS`, matches GitHub `goblinsyard/Goblins-POS`, last commit 2026-07-04) + live testing against the running Docker stack on `http://localhost:8080`. Demo data, non-destructive tests, DB left clean.

Severity: **P0** break/data-loss · **P1** money/accounting correctness · **P2** security/hardening · **P3** data hygiene / enhancement.

---

## P0 — The running stack is a STALE build

The Docker containers you're testing are an **old build (web assets dated Jun 19)**, not the current source (edited Jul 4).

**Proof:** `POST /api/admin/backup` returns `Missing permission: admin`. The Jul-4 source gates that route on `settings.manage` (the "admin" permission never existed — the plan records this exact fix). The live server still runs the pre-fix code.

**Impact:** nothing you test here reflects the current codebase. Several documented fixes (backup route, security hardening, design/charts pass) are not live.

**Fix:** `docker compose up --build` (rebuild `web` + `api`); nginx serves cached bundles otherwise. Confirm after: `/admin/backup` as Owner should succeed; web asset `last-modified` should be today.

---

## P1 — Discounts can mutate CLOSED / PAID orders

`orders.service.ts -> applyDiscount()` has **no `order.status === 'OPEN'` guard** (its sibling `updateTaxService` does).

**Confirmed live:** applied a fixed bill discount to a fully-PAID order -> `totalCents` recomputed to **0** while `paidCents` stayed **13674**. A settled sale is now corrupt and looks massively overpaid; the journal entry was already posted at the old total. Also no check that `orderItemId` belongs to the order (cross-order discount possible).

**Fix:** load the order first, throw if status != OPEN; verify the item's `orderId` matches.

## P1 — Sales with item-level discounts post NO accounting entry

In `recompute()`, `subtotalCents` is already net of item discounts, but `discountCents` re-adds `itemDiscounts`. In `payments.ts`, `netSales = subtotalCents - discountCents` then **double-subtracts** the item discount, so `totalDebit != totalCredit` and the `journalEntry.create` is silently skipped.

**Confirmed live:** order with an item discount -> `journalEntries: 0`; order without -> `1`. **Every discounted-item sale is missing from the ledger** — revenue and VAT under-reported in Accounting / P&L.

**Fix:** compute `netSales` from line totals that are already net (don't subtract item discounts twice), or stop re-including `itemDiscounts` in `discountCents`. Add a test asserting the entry posts and balances for a discounted order.

## P1 — Changing quantity drops an applied item discount

`updateItemQuantity()` recomputes `lineCents` from unit price, discarding a prior line discount while leaving the `OrderDiscount` row -> inconsistent totals / double-count. **Fix:** re-apply or forbid quantity change on discounted lines.

---

## P2 — `GET /api/settings` is ungated; leaks secrets

The route has no `@RequirePermissions`. **Confirmed live:** a 7-permission Waiter reads all 32 settings including `twilio.accountSid` / `twilio.authToken` / `twilio.from`. Empty today, but once SMS/WhatsApp is configured any PIN user can exfiltrate the credentials.

**Fix:** gate the full read on `settings.manage`; expose only the handful of keys the POS/KDS actually need (receipt header/footer, logo, flags) via a public-safe subset. Keep secrets server-side only.

## P2 — Production secret hygiene

- `docker-compose.yml` ships `change-me-in-production` for `JWT_SECRET` / `JWT_REFRESH_SECRET` / `WS_SERVICE_TOKEN`. Fine for local; in Railway these must be strong and the API refuses to boot without a >=16-char `JWT_SECRET` (good).
- Manager-PIN approval does an O(n) argon2 scan over all PIN users (no lockout). Low risk behind the global throttler; add a dedicated limiter if PIN brute-force is a concern.

---

## P3 — Menu data hygiene (live DB)

427 items across 61 categories. Found: **duplicate category names** (Appetizers, Shisha, Pizza, Pasta each appear twice), **6 empty categories**, and ~20 **zero-price items** — some intentional (staff meals) but several look wrong (Espresso, Macchiato, Nescafe, Turkish Coffee, Cheese Cake, Ice-Cream all at EGP 0). Worth a cleanup/merge pass so POS tiles don't ring up EGP 0.

## P3 — Enhancements (from your own plan + review)

- **No POS idle auto-lock** — a logged-in terminal stays open indefinitely. Add an inactivity timeout -> PIN screen.
- Finish deferred plan items: extract shared components into `packages/ui`, split the 1000+ line monoliths (`OrderScreen`, `MenuTab`, `Accounting`, `Settings`), build out `Utilization.tsx`, wire **delivery orders** and **online booking + deposit** (schema fields already exist).

---

### Suggested fix order
1. Rebuild the stack (P0) so you're testing real code.
2. P1 trio — `applyDiscount` guard, journal double-subtract, quantity/discount — all small, all money-correctness.
3. P2 settings gate.
4. P3 menu cleanup + enhancements.

---

## Status update — 2026-10-19 (fixed and verified live)

| Finding | Status |
|---|---|
| P0 stale build | **Fixed.** Root cause: `apps/web.Dockerfile` didn't copy `packages/ui`, so every rebuild since July failed and Docker kept the old images. Rebuilt; new POS/back office/KDS and API are live. |
| P1 discounts on paid orders / cross-order items | **Fixed** — rejected with "Order is not open" / "Item does not belong to this order". |
| P1 item-discounted sales missing from the ledger | **Fixed** — entry posts and balances (12306 = 12306). Bonus pool and receipt/POS discount row corrected too. |
| P1 quantity change dropping discount | **Fixed** — discount re-applied to the new quantity. Bill-level % discounts now also follow items added later. |
| P2 settings leak | **Fixed** — non-managers no longer receive Twilio credentials. |
| P3 POS idle auto-lock | **Done** — `pos.autoLockMinutes` (default 3, 0 = off, Settings → General); 20 s warning, then back to the PIN screen; refresh token revoked on logout. |
| P2 demo logins | **Flagged** — back office shows a warning banner (owners/managers) listing staff still on README passwords/PINs. Change them in Staff. |
| P3 menu data | **Done** — 20 demo items + 9 demo categories hidden (history kept); Smashed Croissant and Ice-Cream now require a choice; server now enforces required options and rejects options from other items. |
| Stale HTML on terminals | **Fixed** — nginx serves `index.html` with `Cache-Control: no-cache`, so a reload always picks up a new build. |
| Note | Back office → Settings "erase demo" button wipes ALL data (real menu, customers, sales), not just demo data. Treat it as a factory reset. |
| P2 secret hygiene (prod secrets), cloud deploy | Open — before going to the cloud. |

Regression tests: `apps/api/test/discount-integrity.spec.ts`.
