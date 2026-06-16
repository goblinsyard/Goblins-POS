# Phase 2 verification — full POS happy path over HTTP
$ErrorActionPreference = 'Stop'
$base = 'http://localhost:3000/api'
function J($o) { $o | ConvertTo-Json -Depth 8 }

# 1. login as manager
$users = Invoke-RestMethod "$base/auth/pin-users"
$mgr = $users | Where-Object { $_.role.name -eq 'Manager' }
$auth = Invoke-RestMethod "$base/auth/login/pin" -Method Post -ContentType 'application/json' -Body (J @{userId=$mgr.id; pin='1111'})
$h = @{ Authorization = "Bearer $($auth.accessToken)" }
Write-Host "1. LOGIN OK ($($auth.user.name))"

# 2. open shift with 500 EGP float (close stale one first)
$cur = Invoke-RestMethod "$base/shifts/current" -Headers $h
if ($cur) { Invoke-RestMethod "$base/shifts/$($cur.id)/close" -Method Post -Headers $h -ContentType 'application/json' -Body (J @{countedCents=[int]$cur.floatCents}) | Out-Null }
$shift = Invoke-RestMethod "$base/shifts/open" -Method Post -Headers $h -ContentType 'application/json' -Body (J @{floatCents=50000})
Write-Host "2. SHIFT OPEN OK (float 500 EGP)"

# 3. floor + menu + payment methods
$floor = Invoke-RestMethod "$base/floor" -Headers $h
$t1 = ($floor | Where-Object name -eq 'Main hall').resources | Where-Object name -eq 'T1'
$menu = Invoke-RestMethod "$base/menu" -Headers $h
$burger = ($menu | Where-Object name -eq 'Burgers').items | Where-Object name -eq 'Classic Goblin Burger'
$capp = ($menu | Where-Object name -eq 'Hot drinks').items | Where-Object name -eq 'Cappuccino'
$fries = ($menu | Where-Object name -eq 'Appetizers').items | Where-Object name -eq 'Fries basket'
$extraCheese = ($burger.modifierGroups.group | Where-Object name -eq 'Extras').modifiers | Where-Object name -eq 'Extra cheese'
$large = ($capp.modifierGroups.group | Where-Object name -eq 'Size').modifiers | Where-Object name -eq 'Large'
$pm = Invoke-RestMethod "$base/payment-methods" -Headers $h
$cash = $pm | Where-Object kind -eq 'CASH'
$card = $pm | Where-Object kind -eq 'CARD'
Write-Host "3. FLOOR+MENU+METHODS OK"

# 4. create dine-in order on T1
$order = Invoke-RestMethod "$base/orders" -Method Post -Headers $h -ContentType 'application/json' -Body (J @{type='DINE_IN'; resourceId=$t1.id; guestCount=3})
Write-Host "4. ORDER CREATED #$($order.number)"

# 5. add items (note: cappuccino morning deal 45 EGP applies 08:00-12:00 Sun-Thu — test runs anytime, so compute expected dynamically)
$order = Invoke-RestMethod "$base/orders/$($order.id)/items" -Method Post -Headers $h -ContentType 'application/json' -Body (J @{items=@(
  @{itemId=$burger.id; quantity=2; modifierIds=@($extraCheese.id); notes='no onions'},
  @{itemId=$capp.id; quantity=1; modifierIds=@($large.id)},
  @{itemId=$fries.id; quantity=1}
)})
$cappLine = $order.items | Where-Object description -eq 'Cappuccino'
$cappUnit = [int]$cappLine.unitCents  # 6000 normally, 4500 during morning deal
$expSub = (18000+1500)*2 + ($cappUnit+1000) + 6000
if ([int]$order.subtotalCents -ne $expSub) { throw "Subtotal mismatch: expected $expSub got $($order.subtotalCents)" }
$expSvc = [Math]::Round($expSub * 0.12)
$expTax = [Math]::Round(($expSub + $expSvc) * 0.14)
$expTotal = $expSub + $expSvc + $expTax
if ([int]$order.totalCents -ne $expTotal) { throw "Total mismatch: expected $expTotal got $($order.totalCents)" }
Write-Host "5. ITEMS + MATH OK — subtotal $($expSub/100), total $($expTotal/100) EGP (12% svc + 14% VAT verified)"

# 6. 10% bill discount
$order = Invoke-RestMethod "$base/orders/$($order.id)/discount" -Method Post -Headers $h -ContentType 'application/json' -Body (J @{kind='PERCENT'; value=1000; reasonCode='LOYAL_CUSTOMER'})
$disc = [Math]::Round($expSub * 0.10)
$after = $expSub - $disc
$svc2 = [Math]::Round($after * 0.12); $tax2 = [Math]::Round(($after+$svc2) * 0.14)
$expTotal2 = $after + $svc2 + $tax2
if ([int]$order.totalCents -ne $expTotal2) { throw "Discount total mismatch: expected $expTotal2 got $($order.totalCents)" }
Write-Host "6. DISCOUNT OK — total $($expTotal2/100) EGP (verified)"

# 7. split cappuccino + fries to child bill
$cappLine = $order.items | Where-Object description -eq 'Cappuccino'
$friesLine = $order.items | Where-Object description -eq 'Fries basket'
$split = Invoke-RestMethod "$base/orders/$($order.id)/split" -Method Post -Headers $h -ContentType 'application/json' -Body (J @{orderItemIds=@($cappLine.id, $friesLine.id)})
$childId = $split.child.id
Write-Host "7. SPLIT OK — child #$($split.child.number) = $($split.child.totalCents/100) EGP"

# 8. pay child fully in cash with change
$child = Invoke-RestMethod "$base/orders/$childId" -Headers $h
$tender = [int]([Math]::Ceiling($child.totalCents / 10000) * 10000)
$payRes = Invoke-RestMethod "$base/orders/$childId/pay" -Method Post -Headers $h -ContentType 'application/json' -Body (J @{payments=@(@{methodId=$cash.id; amountCents=[int]$child.totalCents; tenderedCents=$tender})})
if (-not $payRes.fullyPaid) { throw "Child not fully paid" }
if ([int]$payRes.changeCents -ne ($tender - [int]$child.totalCents)) { throw "Change calc wrong" }
Write-Host "8. CASH PAYMENT OK — change $($payRes.changeCents/100) EGP, drawer opens: $($payRes.drawerOpens)"

# 9. pay parent with SPLIT cash+card
$parent = Invoke-RestMethod "$base/orders/$($order.id)" -Headers $h
$half = [int][Math]::Floor($parent.totalCents / 2)
$rest = [int]$parent.totalCents - $half
$payRes2 = Invoke-RestMethod "$base/orders/$($order.id)/pay" -Method Post -Headers $h -ContentType 'application/json' -Body (J @{payments=@(
  @{methodId=$cash.id; amountCents=$half; tenderedCents=$half},
  @{methodId=$card.id; amountCents=$rest; reference='AUTH-1234'}
)})
if (-not $payRes2.fullyPaid) { throw "Parent not fully paid" }
Write-Host "9. SPLIT PAYMENT OK (cash $($half/100) + card $($rest/100))"

# 10. receipt
$receipt = Invoke-RestMethod "$base/orders/$($order.id)/receipt" -Headers $h
if ($receipt.text -notmatch 'TOTAL') { throw "Receipt missing total" }
Write-Host "10. RECEIPT OK ($((($receipt.text) -split "`n").Count) lines)"

# 11. void-item flow on a fresh order + audit trail check
$o2 = Invoke-RestMethod "$base/orders" -Method Post -Headers $h -ContentType 'application/json' -Body (J @{type='TAKEAWAY'})
$o2 = Invoke-RestMethod "$base/orders/$($o2.id)/items" -Method Post -Headers $h -ContentType 'application/json' -Body (J @{items=@(@{itemId=$fries.id; quantity=1})})
$line = $o2.items[0]
$o2 = Invoke-RestMethod "$base/orders/$($o2.id)/void-item" -Method Post -Headers $h -ContentType 'application/json' -Body (J @{orderItemId=$line.id; reason='customer changed mind'})
if ([int]$o2.totalCents -ne 0) { throw "Void did not zero the order" }
Invoke-RestMethod "$base/orders/$($o2.id)/void" -Method Post -Headers $h -ContentType 'application/json' -Body (J @{reason='abandoned'}) | Out-Null
Write-Host "11. VOID ITEM + VOID ORDER OK"

# 12. drawer open (no sale) — audited
Invoke-RestMethod "$base/shifts/$($shift.id)/cash-movement" -Method Post -Headers $h -ContentType 'application/json' -Body (J @{kind='DRAWER_OPEN'; amountCents=0; reason='change request'}) | Out-Null
Write-Host "12. NO-SALE DRAWER OPEN OK"

# 13. X report
$x = Invoke-RestMethod "$base/shifts/$($shift.id)/x-report" -Headers $h
Write-Host "13. X REPORT OK — orders: $($x.orderCount), gross $($x.grossCents/100) EGP"

# 14. close shift with blind count (expected cash = float + cash sales)
$expectedCash = [int]$x.cash.expectedCents
$z = Invoke-RestMethod "$base/shifts/$($shift.id)/close" -Method Post -Headers $h -ContentType 'application/json' -Body (J @{countedCents=$expectedCash})
if ([int]$z.zReport.varianceCents -ne 0) { throw "Z variance should be 0, got $($z.zReport.varianceCents)" }
Write-Host "14. Z REPORT OK — gross $($z.zReport.grossCents/100) EGP, variance 0"

# 15. audit log contains the gated actions
$audit = Invoke-RestMethod "$base/audit?take=50" -Headers (@{ Authorization = $h.Authorization })
$actions = $audit | ForEach-Object { $_.action }
foreach ($must in @('order.void_item','order.void','discount.apply','order.split','drawer.open_no_sale','shift.open','shift.close','shift.x_report')) {
  if ($actions -notcontains $must) { throw "Audit missing action: $must" }
}
Write-Host "15. AUDIT TRAIL OK (all privileged actions logged)"
Write-Host ""
Write-Host "=== PHASE 2 BACKEND: ALL 15 CHECKS PASSED ==="
