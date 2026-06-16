# Phase 5 verification - inventory, purchasing, manufacturing, sale deduction
$ErrorActionPreference = 'Stop'
$base = 'http://localhost:3000/api'
function J($o) { $o | ConvertTo-Json -Depth 8 }

$users = Invoke-RestMethod "$base/auth/pin-users"
$mgr = $users | Where-Object { $_.role.name -eq 'Manager' }
$auth = Invoke-RestMethod "$base/auth/login/pin" -Method Post -ContentType 'application/json' -Body (J @{userId=$mgr.id; pin='1111'})
$h = @{ Authorization = "Bearer $($auth.accessToken)" }
$cur = Invoke-RestMethod "$base/shifts/current" -Headers $h
if (-not $cur) { $null = Invoke-RestMethod "$base/shifts/open" -Method Post -Headers $h -ContentType 'application/json' -Body (J @{floatCents=50000}) }
Write-Host "1. LOGIN + SHIFT OK"

# locations + ingredients
$locs = Invoke-RestMethod "$base/inventory/locations" -Headers $h
$bar = $locs | Where-Object name -eq 'Bar'
$main = $locs | Where-Object name -eq 'Main store'
$kitchen = $locs | Where-Object name -eq 'Kitchen'
$ings = Invoke-RestMethod "$base/inventory/ingredients" -Headers $h
$mojitoBase = $ings | Where-Object name -like 'Mojito base*'
$mint = $ings | Where-Object name -eq 'Fresh mint'
$sugar = $ings | Where-Object name -eq 'Sugar'
$limes = $ings | Where-Object name -eq 'Limes'
$beef = $ings | Where-Object name -like 'Beef patty*'
Write-Host "2. LOCATIONS + INGREDIENTS OK"

function BarQty($ingId) {
  $lv = Invoke-RestMethod "$base/inventory/levels?locationId=$($bar.id)" -Headers $h
  $row = $lv | Where-Object { $_.ingredientId -eq $ingId }
  if ($row) { [double]$row.quantity } else { 0 }
}

# --- DoD #3: production order consumes raw, creates intermediate, sale consumes intermediate ---
$mintBefore = BarQty $mint.id
$baseBefore = BarQty $mojitoBase.id

$recipes = Invoke-RestMethod "$base/inventory/production/recipes" -Headers $h
$mojitoRecipe = $recipes | Where-Object { $_.outputIngredient.id -eq $mojitoBase.id }
# produce 2000 ml (one full batch)
$po = Invoke-RestMethod "$base/inventory/production" -Method Post -Headers $h -ContentType 'application/json' -Body (J @{recipeId=$mojitoRecipe.id; batchQty=2000})
if ($po.status -ne 'COMPLETED') { throw "Production not completed" }
Write-Host "3. PRODUCTION ORDER OK (2L mojito base)"

$mintAfter = BarQty $mint.id
$baseAfter = BarQty $mojitoBase.id
# recipe: 0.06 g mint per ml -> 120 g consumed; base +2000 ml
if ([Math]::Abs(($mintBefore - $mintAfter) - 120) -gt 0.01) { throw "Mint consumption wrong: $($mintBefore - $mintAfter)" }
if ([Math]::Abs(($baseAfter - $baseBefore) - 2000) -gt 0.01) { throw "Base not produced: +$($baseAfter - $baseBefore)" }
Write-Host "4. RAW CONSUMED (mint -120g), INTERMEDIATE CREATED (+2000ml) - VERIFIED"

# sell a Virgin Mojito -> consumes 200ml base + 5g mint garnish
$menu = Invoke-RestMethod "$base/menu" -Headers $h
$mojito = ($menu | Where-Object name -eq 'Mocktails').items | Where-Object name -eq 'Virgin Mojito'
$o = Invoke-RestMethod "$base/orders" -Method Post -Headers $h -ContentType 'application/json' -Body (J @{type='TAKEAWAY'})
$o = Invoke-RestMethod "$base/orders/$($o.id)/items" -Method Post -Headers $h -ContentType 'application/json' -Body (J @{items=@(@{itemId=$mojito.id; quantity=1})})
$pm = Invoke-RestMethod "$base/payment-methods" -Headers $h
$cash = $pm | Where-Object kind -eq 'CASH'
$null = Invoke-RestMethod "$base/orders/$($o.id)/pay" -Method Post -Headers $h -ContentType 'application/json' -Body (J @{payments=@(@{methodId=$cash.id; amountCents=[int]$o.totalCents; tenderedCents=[int]$o.totalCents})})
$baseAfterSale = BarQty $mojitoBase.id
if ([Math]::Abs(($baseAfter - $baseAfterSale) - 200) -gt 0.01) { throw "Sale should consume 200ml base, got $($baseAfter - $baseAfterSale)" }
Write-Host "5. SALE CONSUMED INTERMEDIATE (-200ml base) - DoD #3 VERIFIED"

# --- purchasing: PO -> receive -> moving-average cost + batch + price history ---
$sup = (Invoke-RestMethod "$base/inventory/suppliers" -Headers $h) | Select-Object -First 1
$beefAvgBefore = [double]$beef.avgCostCents
$newPo = Invoke-RestMethod "$base/inventory/purchase-orders" -Method Post -Headers $h -ContentType 'application/json' -Body (J @{
  supplierId=$sup.id
  lines=@(@{ingredientId=$beef.id; quantity=50; unitCostCents=4000})  # price went up: 35 -> 40 EGP
})
Write-Host "6. PO CREATED (50 patties @ 40 EGP)"

$receipt = Invoke-RestMethod "$base/inventory/purchase-orders/$($newPo.id)/receive" -Method Post -Headers $h -ContentType 'application/json' -Body (J @{
  locationId=$kitchen.id
  invoiceNumber='INV-001'
  lines=@(@{poLineId=$newPo.lines[0].id; quantity=30; expiresAt=(Get-Date).AddDays(5).ToString('o'); lotCode='LOT-A'})
})
Write-Host "7. PARTIAL RECEIVE OK (30/50 with batch + expiry)"

$poList = Invoke-RestMethod "$base/inventory/purchase-orders" -Headers $h
$poNow = $poList | Where-Object id -eq $newPo.id
if ($poNow.status -ne 'PARTIALLY_RECEIVED') { throw "PO should be PARTIALLY_RECEIVED, got $($poNow.status)" }
$ings2 = Invoke-RestMethod "$base/inventory/ingredients" -Headers $h
$beefNow = $ings2 | Where-Object id -eq $beef.id
if ([double]$beefNow.avgCostCents -le $beefAvgBefore) { throw "Moving average should rise (was $beefAvgBefore, now $($beefNow.avgCostCents))" }
if ([double]$beefNow.lastCostCents -ne 4000) { throw "Last cost should be 4000" }
Write-Host "8. MOVING-AVERAGE COST OK ($beefAvgBefore -> $($beefNow.avgCostCents) pt), last cost 4000"

# expiring batches (FEFO list)
$expiring = Invoke-RestMethod "$base/inventory/expiring?days=7" -Headers $h
if (-not ($expiring | Where-Object lotCode -eq 'LOT-A')) { throw "Expiring batch missing" }
Write-Host "9. EXPIRY/FEFO LIST OK"

# transfer main -> kitchen
$flour = $ings | Where-Object name -eq 'Flour'
$null = Invoke-RestMethod "$base/inventory/transfer" -Method Post -Headers $h -ContentType 'application/json' -Body (J @{ingredientId=$flour.id; fromLocationId=$main.id; toLocationId=$kitchen.id; quantity=5000})
Write-Host "10. TRANSFER OK (5kg flour main -> kitchen)"

# waste log
$null = Invoke-RestMethod "$base/inventory/waste" -Method Post -Headers $h -ContentType 'application/json' -Body (J @{ingredientId=$limes.id; locationId=$bar.id; quantity=200; reason='spoilage'})
Write-Host "11. WASTE LOG OK (200g limes, spoilage)"

# spot count with variance
$count = Invoke-RestMethod "$base/inventory/counts" -Method Post -Headers $h -ContentType 'application/json' -Body (J @{locationId=$bar.id; kind='SPOT'; ingredientIds=@($sugar.id)})
$sysQty = [double]($count.lines | Where-Object ingredientId -eq $sugar.id).systemQty
$posted = Invoke-RestMethod "$base/inventory/counts/$($count.id)/submit" -Method Post -Headers $h -ContentType 'application/json' -Body (J @{lines=@(@{ingredientId=$sugar.id; countedQty=($sysQty - 50)})})
$varLine = $posted.lines | Where-Object ingredientId -eq $sugar.id
if ([double]$varLine.varianceQty -ne -50) { throw "Variance should be -50, got $($varLine.varianceQty)" }
$sugarBarNow = BarQty $sugar.id
if ([Math]::Abs($sugarBarNow - ($sysQty - 50)) -gt 0.01) { throw "Stock level not adjusted by count" }
Write-Host "12. STOCK COUNT OK (variance -50g posted as adjustment)"

# movements ledger covers everything
$moves = Invoke-RestMethod "$base/inventory/movements?take=200" -Headers $h
$kinds = $moves | ForEach-Object { $_.kind } | Sort-Object -Unique
foreach ($must in @('RECEIPT','SALE_DEDUCTION','PRODUCTION_IN','PRODUCTION_OUT','TRANSFER','WASTE','COUNT_ADJUSTMENT')) {
  if ($kinds -notcontains $must) { throw "Ledger missing kind: $must" }
}
Write-Host "13. SINGLE LEDGER OK (all 7 movement kinds present)"

# low stock endpoint responds
$null = Invoke-RestMethod "$base/inventory/low-stock" -Headers $h
Write-Host "14. LOW-STOCK ENDPOINT OK"

# RBAC: waiter cannot adjust stock
$waiter = $users | Where-Object { $_.role.name -eq 'Waiter' }
$wAuth = Invoke-RestMethod "$base/auth/login/pin" -Method Post -ContentType 'application/json' -Body (J @{userId=$waiter.id; pin='3333'})
$wh = @{ Authorization = "Bearer $($wAuth.accessToken)" }
try {
  Invoke-RestMethod "$base/inventory/adjust" -Method Post -Headers $wh -ContentType 'application/json' -Body (J @{ingredientId=$sugar.id; locationId=$bar.id; delta=100; reason='nope'})
  throw "WAITER ADJUSTED STOCK - RBAC BROKEN"
} catch {
  if ($_.Exception.Message -like '*RBAC BROKEN*') { throw }
  Write-Host "15. RBAC OK (waiter denied stock adjust)"
}
Write-Host ""
Write-Host "=== PHASE 5: ALL 15 CHECKS PASSED ==="
