# Phase 6 verification - costing engine, menu engineering, expenses, P&L, VAT
$ErrorActionPreference = 'Stop'
$base = 'http://localhost:3000/api'
function J($o) { $o | ConvertTo-Json -Depth 8 }

$users = Invoke-RestMethod "$base/auth/pin-users"
$mgr = $users | Where-Object { $_.role.name -eq 'Manager' }
$auth = Invoke-RestMethod "$base/auth/login/pin" -Method Post -ContentType 'application/json' -Body (J @{userId=$mgr.id; pin='1111'})
$h = @{ Authorization = "Bearer $($auth.accessToken)" }
Write-Host "1. LOGIN OK"

# item costs (theoretical)
$costs = Invoke-RestMethod "$base/costing/items" -Headers $h
$marg = $costs | Where-Object name -eq 'Margherita'
if ([int]$marg.costCents -ne 3676) { throw "Margherita cost expected 3676, got $($marg.costCents)" }
if ([int]$marg.costPctBps -ne 2298) { throw "Cost pct expected 2298 bps, got $($marg.costPctBps)" }
Write-Host "2. ITEM COSTS OK (Margherita 36.76 EGP = 22.98%, matches hand calc)"

# cost summary (theoretical vs actual over last 24h - sales happened in phase tests)
$sum = Invoke-RestMethod "$base/costing/summary" -Headers $h
if ($null -eq $sum.actualCostCents) { throw "No actual cost computed" }
Write-Host "3. COST SUMMARY OK (revenue $($sum.revenueCents/100), actual COGS $($sum.actualCostCents/100), waste $($sum.wasteCostCents/100) EGP)"

# menu engineering (uses 2wk seeded history)
$me = Invoke-RestMethod "$base/costing/menu-engineering?days=30" -Headers $h
$classes = $me | ForEach-Object { $_.class } | Sort-Object -Unique
if (-not $me) { throw "Menu engineering empty" }
Write-Host "4. MENU ENGINEERING OK ($(($me|Measure-Object).Count) items classified: $($classes -join ', '))"

# snapshot + margin alerts
$snap = Invoke-RestMethod "$base/costing/snapshot" -Method Post -Headers $h
Write-Host "5. COST SNAPSHOT OK ($($snap.snapshots) items, $(($snap.alerts|Measure-Object).Count) margin alerts)"

# expense entry
$cats = Invoke-RestMethod "$base/expenses/categories" -Headers $h
$maint = $cats | Where-Object name -eq 'Maintenance'
$exp = Invoke-RestMethod "$base/expenses" -Method Post -Headers $h -ContentType 'application/json' -Body (J @{categoryId=$maint.id; description='Billiards cloth repair'; amountCents=120000; paymentMethod='cash'})
Write-Host "6. EXPENSE CREATED (1200 EGP maintenance)"

# recurring expense
$rent = $cats | Where-Object name -eq 'Rent'
$null = Invoke-RestMethod "$base/expenses" -Method Post -Headers $h -ContentType 'application/json' -Body (J @{categoryId=$rent.id; description='Monthly rent'; amountCents=5000000; isRecurring=$true; recurrence='monthly'})
Write-Host "7. RECURRING EXPENSE OK (50,000 EGP rent, monthly)"

# daily P&L
$pnl = Invoke-RestMethod "$base/expenses/pnl" -Headers $h
if ($null -eq $pnl.netCents) { throw "P&L missing net" }
if ($pnl.expensesCents -lt 120000) { throw "P&L missing today's expenses" }
Write-Host "8. DAILY P&L OK (rev $($pnl.revenueCents/100) - COGS $($pnl.cogsCents/100) - exp $($pnl.expensesCents/100) = net $($pnl.netCents/100) EGP, by dept: R=$($pnl.revenueByDepartment.Restaurant/100) B=$($pnl.revenueByDepartment.Billiards/100) PS=$($pnl.revenueByDepartment.PlayStation/100))"

# VAT report
$vat = Invoke-RestMethod "$base/expenses/vat-report" -Headers $h
if (-not $vat) { throw "VAT report empty" }
Write-Host "9. VAT REPORT OK ($(($vat|Measure-Object).Count) day rows)"

# RBAC: cashier cannot see P&L
$cashier = $users | Where-Object { $_.role.name -eq 'Cashier' }
$cAuth = Invoke-RestMethod "$base/auth/login/pin" -Method Post -ContentType 'application/json' -Body (J @{userId=$cashier.id; pin='2222'})
try {
  Invoke-RestMethod "$base/expenses/pnl" -Headers @{ Authorization = "Bearer $($cAuth.accessToken)" }
  throw "CASHIER SAW PNL - RBAC BROKEN"
} catch {
  if ($_.Exception.Message -like '*RBAC BROKEN*') { throw }
  Write-Host "10. RBAC OK (cashier denied P&L)"
}
Write-Host ""
Write-Host "=== PHASE 6: ALL 10 CHECKS PASSED ==="
