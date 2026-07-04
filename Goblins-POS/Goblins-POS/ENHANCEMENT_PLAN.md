# Goblins Yard POS — Enhancement Plan

Status baseline: 9 build phases + feature passes complete. System is functionally mature (20 API
modules, full accounting/HR/CRM/inventory). This plan covers **pre-launch hardening + design
unification + missing features + repo cleanup**. Context: *launching soon*, so security-before-launch
is non-negotiable.

Priority order is sequenced to de-risk launch first, then maximize visible impact.

---

## Phase A — Repo cleanup & launch safety ✅ DONE (2026-07-04)

- [x] **Removed committed secret risk**: `apps/backoffice/.vercel/` deleted from disk; added `.vercel/`
      + broadened `.env.*` to `.gitignore`. (Note: `.vercel/` was *never git-tracked* — the OIDC token
      was only local, never pushed. Still cleaned up defensively.)
- [x] **Deleted junk**: `Gabitos-POS.zip` (misnamed HTML error page) `git rm`'d. Also removed the
      throwaway `apps/api/prisma/check_clients_xlsx.ts` (hardcoded personal path, broke typecheck).
- [x] **Added `.env.example`** documenting all env vars incl. new `CORS_ORIGINS`, `WS_SERVICE_TOKEN`.
- [ ] **DEFERRED (post-launch, deploy-entangled)**: nested-folder restructure, stray root
      `apps/pos/package.json` (has "Vercel compatibility" commits — may be a live deploy root),
      `push.bat` scope. Low value, nonzero risk right before launch.

## Phase B — Security hardening ✅ DONE (2026-07-04)

- [x] **Removed hardcoded JWT secret fallback** (`auth.module.ts`) — now fails fast in production if
      `JWT_SECRET` is unset/short; warns and falls back only in non-production.
- [x] **Authenticated the WebSocket gateway** (`realtime/realtime.gateway.ts`) — verifies a user JWT
      or `WS_SERVICE_TOKEN` (print-service) on connect; enforced in production, permissive-with-warning
      in dev. KDS + print-service clients updated to send tokens. CORS tightened to a `CORS_ORIGINS`
      allowlist on both HTTP (`main.ts`) and WS (falls back to reflect-origin in local dev).
- [x] **CORRECTION to the audit**: the claimed RBAC gaps *do not exist*. Every controller gates every
      route with `@RequirePermissions`. `db/reset`/`db/erase-demo`/`db/restore`/payment-methods/staff
      are `settings.manage`/`staff.manage` — which Manager and below lack, i.e. effectively Owner-only.
      A cashier CANNOT reach payroll or db reset. **Real bug fixed**: `POST /admin/backup` was gated on
      a non-existent `'admin'` permission → permanently 403 for everyone (incl. Owner); changed to
      `settings.manage`.
- [ ] **DEFERRED**: dedicated `system.danger` permission for destructive DB ops. Owner='ALL' is
      computed at seed time, so adding a code would lock the Owner out of `db/reset` on the
      already-seeded prod DB until a re-seed. Do it as a coordinated migration post-launch.
- [ ] **DEFERRED (optional)**: rate-limit/lockout on manager-PIN approval (`auth.service.ts` O(n) argon2
      scan). Low risk given global throttler (300 req/60s); revisit if PIN brute-force is a concern.

**Verification**: `pnpm -r typecheck` green (6/6), `pnpm --filter @goblins/shared test` 44/44, changed
files lint clean (0 errors). NOTE: repo-wide `pnpm lint` has 27 pre-existing errors + 375 warnings
(drift from the sync-commit era) — not introduced here; worth a dedicated cleanup pass.

## Phase B.5 — Lint debt cleanup ✅ DONE (2026-07-04)

- [x] Fixed all **27 eslint errors** repo-wide (10 auto-fixed: prefer-const/no-useless-escape;
      17 hand-fixed: unused vars/imports, unused catch bindings, useless assignments, a regex escape).
      `pnpm lint` now **exits 0**; `pnpm -r typecheck` green; shared tests 44/44.
- [x] Removed two dead prompt-based helpers in `MenuTab.tsx` (`setPrice`/`rename`) superseded by the
      full edit dialog.
- [ ] **DEFERRED**: 375 `no-explicit-any` **warnings** (non-blocking). Concentrated in the large files
      Phase C refactors anyway (`OrderScreen`, `Accounting`, `MenuTab`, `admin.controller`) — type them
      during that refactor rather than a churny mass pass now. Lint stays error-gated so no new errors creep in.

## Phase C — Shared design system + full unification (the "look")

Goal: the three apps should read as one product. Highest visible impact.

- [x] **DONE — Fixed POS broken Tailwind (C1)**: `animate-fade-in` keyframes added; intermediate
      `goblin-650/750/850` hover stops defined via `color-mix` of adjacent themed vars (theme + light/dark
      aware, no hand-tuning); `yellow-250/450` + `spacing 4.5/5.5` added. Verified in built CSS.
- [x] **DONE — Created `packages/ui` (C2)**: `theme.css` (goblin scale + 5 themes + light/dark +
      a11y rules) and `tailwind-preset.js` (colors/spacing/keyframes). **Consumed via relative import /
      Vite-alias, NOT a package.json workspace dep** — same Vercel-safe pattern as `@goblins/shared`
      (workspace deps previously broke Vercel builds). POS migrated to consume it; rebuild produced
      byte-identical CSS (37.68 kB) → zero visual regression. Back office + KDS wire in next.
- [ ] **Extract shared components** from back office's `apps/backoffice/src/lib/ui.tsx` (Card, Table,
      Btn, Field, Select, Modal, Spinner, Pills, useLoad) into `packages/ui` so POS/KDS reuse them.
- [ ] **Fix POS broken Tailwind (quick win, do early)**:
      - Define `animate-fade-in` keyframes (used 7+ places, never defined — modals don't animate).
      - Add missing color stops / sizes or correct class names: `bg-goblin-650/750/850`,
        `yellow-450/250`, `h-4.5`, `w-5.5` (broken hover/badge states in `OrderScreen.tsx`, `Floor.tsx`).
- [x] **DONE — Adopted Lucide icons (C3)**: `lucide-react@1.23.0` in all 3 apps. POS ~95+ emoji→icons
      (14 files); back office per-tab nav icons + shell + tab glyphs (✕/★/⚠/🎂/chevrons); KDS keypad/
      recall/reprint/warning. Full typecheck + lint (0 errors) + all 3 builds green. Note: 1.23.0 renames
      some icons (AlertTriangle↔TriangleAlert, Ellipsis, ClockPlus).
- [x] **DONE — Restyled Back office (C4)**: wired shared theme + preset; added a light/dark toggle
      (default light, persisted to `bo.mode`); recolored the `ui.tsx` kit, App shell (login/sidebar/
      header) and all 17 tabs from emerald/slate/white → goblin tokens (~1000 tokens via scripted,
      token-exact sweep; semantic red/amber/blue kept). Build + typecheck clean. Pending: live visual QA.
- [x] **DONE — Charts (C5)**: Recharts added. Validated CVD-safe categorical palette (green-free;
      green reserved for brand/single-series) exposed as `--chart-1..6` CSS vars → auto-theme on toggle.
      Themed `charts.tsx` helper (RevenueTrend / CategoryBars / SharePie / ChartCard) built to the
      dataviz method (single-series=brand/no-legend, categorical=fixed-order+legend, one axis, tooltips).
      Wired into Dashboard (replaced hand-rolled SVG line+donut, fixed emoji→Lucide + off-palette
      indigo/amber badges), Sales, P&L, Utilization. Typecheck+lint+build green. Pending: real-data QA.
- [x] **DONE — Back office EN/AR scaffold (C6)**: i18n helper (`lib/i18n.ts`, EN/AR dict), language
      toggle, RTL `dir` switching. Shell/nav/login/common-ui translated; tab bodies stay EN (translate
      incrementally against the same `t()`). Fixed an RTL sidebar CSS-order bug (`md:!translate-x-0`).
      Verified via Arabic RTL screenshot — sidebar flips right, nav in Arabic, icons intact.
- [x] **DONE — Restyled KDS (C6)**: wired shared theme (dark goblin, no light mode); swept zinc/emerald
      → goblin tokens; kept semantic red/amber ticket-age urgency colors. Typecheck + build green.
- [ ] **Refactor monoliths** as we touch them: POS `OrderScreen.tsx` (1085), `ReservationsTab.tsx`
      (1205); back office `MenuTab`/`Accounting`/`Settings` (~1400 each); KDS single-file `App.tsx`.
      Also consolidate POS's scattered inline `lang === 'ar' ? …` ternaries into `i18n.ts`.
- [ ] **Build out `Utilization.tsx`** (currently 48 lines) into a real report with the new charts.

## Phase D — New features (missing capabilities)

- [ ] **Delivery orders**: wire the dead `OrderType.DELIVERY`. Add delivery address, customer phone,
      driver assignment, delivery fee, and a dispatch/status flow. Schema fields on `Order`, POS
      order-type flow, back-office delivery board.
- [ ] **Online booking**: add a `@Public()` rate-limited **booking submission** endpoint (availability
      already exists) + optional **deposit capture** (`Reservation.depositCents` is stored but no
      payment flow). Deliver an embeddable widget for goblinsyard.com.
- [ ] **(Optional, larger) True multi-branch isolation**: add branch scoping to currently-global master
      data (`MenuItem`, `Category`, `Ingredient`, `Supplier`, `RatePlan`, `Customer`, `PaymentMethod`).
      Only if multiple branches are real near-term; otherwise defer.

## Phase E — Verification (each phase)

- [ ] `pnpm typecheck && pnpm lint` (6 packages) green.
- [ ] `pnpm --filter @goblins/shared test` (money/time-billing) + API integration/E2E specs green.
- [ ] Drive the actual flow in the running app for each change (use `/verify`), not just tests.
- [ ] Rebuild Docker `web`+`api` after frontend/API changes (nginx serves stale bundles otherwise).

---

### Suggested execution order
A (½ day) → B (1–2 days, launch-critical) → C.fix-broken-styles + icons (quick, visible) →
C shared design system + back-office/KDS restyle + charts → D delivery + online booking.
