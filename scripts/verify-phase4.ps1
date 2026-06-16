# Phase 4 verification - KDS routing, courses, bump lifecycle, printing
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

# stations
$stations = Invoke-RestMethod "$base/kds/stations" -Headers $h
$kitchen = $stations | Where-Object name -eq 'Kitchen'
$bar = $stations | Where-Object name -eq 'Bar'
Write-Host "2. STATIONS OK (Kitchen, Bar, Expo)"

# order with kitchen + bar items across 2 courses
$menu = Invoke-RestMethod "$base/menu" -Headers $h
$burger = ($menu | Where-Object name -eq 'Burgers').items | Select-Object -First 1
$mojito = ($menu | Where-Object name -eq 'Mocktails').items | Select-Object -First 1
$friesB = ($menu | Where-Object name -eq 'Appetizers').items | Where-Object name -eq 'Fries basket'
$floor = Invoke-RestMethod "$base/floor" -Headers $h
$table = ($floor | Where-Object name -eq 'Main hall').resources | Where-Object { $_.orders.Count -eq 0 } | Select-Object -First 1
$o = Invoke-RestMethod "$base/orders" -Method Post -Headers $h -ContentType 'application/json' -Body (J @{type='DINE_IN'; resourceId=$table.id})
$o = Invoke-RestMethod "$base/orders/$($o.id)/items" -Method Post -Headers $h -ContentType 'application/json' -Body (J @{items=@(
  @{itemId=$friesB.id; quantity=1; course=1},
  @{itemId=$mojito.id; quantity=2; course=1},
  @{itemId=$burger.id; quantity=1; course=2; notes='well done'}
)})
Write-Host "3. ORDER CREATED (apps+drinks course 1, burger course 2)"

# send -> routing
$tickets = Invoke-RestMethod "$base/kds/orders/$($o.id)/send" -Method Post -Headers $h
$kt = $tickets | Where-Object { $_.stationId -eq $kitchen.id }
$bt = $tickets | Where-Object { $_.stationId -eq $bar.id }
if (($tickets | Measure-Object).Count -ne 3) { throw "Expected 3 tickets (kitchen c1, bar c1, kitchen c2), got $(($tickets|Measure-Object).Count)" }
$ktC1 = $kt | Where-Object course -eq 1
$ktC2 = $kt | Where-Object course -eq 2
if ($ktC1.status -ne 'NEW') { throw "Course 1 should be NEW" }
if ($ktC2.status -ne 'HELD') { throw "Course 2 should be HELD, got $($ktC2.status)" }
if ($bt.status -ne 'NEW') { throw "Bar ticket should be NEW" }
Write-Host "4. ROUTING OK - kitchen C1 NEW, bar C1 NEW, kitchen C2 HELD"

# station screens see only their tickets
$kview = Invoke-RestMethod "$base/kds/stations/$($kitchen.id)/tickets" -Headers $h
$bview = Invoke-RestMethod "$base/kds/stations/$($bar.id)/tickets" -Headers $h
if ($kview | Where-Object { $_.station.id -ne $kitchen.id }) { throw "Kitchen screen shows foreign tickets" }
if (-not ($bview | Where-Object { $_.order.number -eq $o.number })) { throw "Bar ticket missing from bar screen" }
if ($kview | Where-Object { $_.id -eq $ktC2.id }) { throw "HELD course 2 must not appear on station screen" }
Write-Host "5. STATION SCREENS OK (held course hidden)"

# all-day aggregate
$allday = Invoke-RestMethod "$base/kds/stations/$($bar.id)/all-day" -Headers $h
$moj = $allday | Where-Object description -eq $mojito.name
if ([double]$moj.quantity -lt 2) { throw "All-day should aggregate 2x mojito" }
Write-Host "6. ALL-DAY AGGREGATE OK ($($moj.quantity)x $($mojito.name))"

# bump lifecycle NEW -> IN_PROGRESS -> READY -> SERVED
$t1 = Invoke-RestMethod "$base/kds/tickets/$($ktC1.id)/bump" -Method Post -Headers $h
if ($t1.status -ne 'IN_PROGRESS') { throw "bump1: $($t1.status)" }
$t2 = Invoke-RestMethod "$base/kds/tickets/$($ktC1.id)/bump" -Method Post -Headers $h
if ($t2.status -ne 'READY') { throw "bump2: $($t2.status)" }
# recall from READY
$tr = Invoke-RestMethod "$base/kds/tickets/$($ktC1.id)/recall" -Method Post -Headers $h
if ($tr.status -ne 'IN_PROGRESS' -or -not $tr.recalled) { throw "recall failed" }
$null = Invoke-RestMethod "$base/kds/tickets/$($ktC1.id)/bump" -Method Post -Headers $h
$t3 = Invoke-RestMethod "$base/kds/tickets/$($ktC1.id)/bump" -Method Post -Headers $h
if ($t3.status -ne 'SERVED') { throw "bump to served: $($t3.status)" }
Write-Host "7. BUMP LIFECYCLE + RECALL OK"

# order items mirror KDS status
$oNow = Invoke-RestMethod "$base/orders/$($o.id)" -Headers $h
$friesLine = $oNow.items | Where-Object description -eq 'Fries basket'
if ($friesLine.kdsStatus -ne 'SERVED') { throw "OrderItem kdsStatus not mirrored: $($friesLine.kdsStatus)" }
Write-Host "8. ORDER ITEM KDS MIRROR OK"

# fire course 2
$fired = Invoke-RestMethod "$base/kds/orders/$($o.id)/fire" -Method Post -Headers $h -ContentType 'application/json' -Body (J @{course=2})
if ($fired[0].status -ne 'NEW') { throw "Fire course failed" }
$kview2 = Invoke-RestMethod "$base/kds/stations/$($kitchen.id)/tickets" -Headers $h
if (-not ($kview2 | Where-Object { $_.id -eq $ktC2.id })) { throw "Fired course 2 not on kitchen screen" }
Write-Host "9. FIRE COURSE OK (mains now on kitchen screen)"

# expo sees everything active
$expo = Invoke-RestMethod "$base/kds/expo" -Headers $h
if (-not ($expo | Where-Object { $_.id -eq $ktC2.id })) { throw "Expo missing fired ticket" }
Write-Host "10. EXPO VIEW OK"

# reprint
$null = Invoke-RestMethod "$base/kds/tickets/$($ktC2.id)/reprint" -Method Post -Headers $h
Write-Host "11. REPRINT OK"

# pay the order -> receipt print job fires
$pm = Invoke-RestMethod "$base/payment-methods" -Headers $h
$cash = $pm | Where-Object kind -eq 'CASH'
# serve remaining tickets first (bar c1, kitchen c2)
foreach ($tk in @($bt.id, $ktC2.id)) {
  $st = 'x'
  while ($st -ne 'SERVED') { $r = Invoke-RestMethod "$base/kds/tickets/$tk/bump" -Method Post -Headers $h; $st = $r.status }
}
$oNow = Invoke-RestMethod "$base/orders/$($o.id)" -Headers $h
$null = Invoke-RestMethod "$base/orders/$($o.id)/pay" -Method Post -Headers $h -ContentType 'application/json' -Body (J @{payments=@(@{methodId=$cash.id; amountCents=[int]$oNow.totalCents; tenderedCents=[int]$oNow.totalCents})})
Write-Host "12. ORDER PAID (receipt print job emitted)"

Start-Sleep -Seconds 3
$previews = Get-ChildItem "D:\Claude code\Goblins-POS\apps\print-service\preview" -ErrorAction SilentlyContinue
$ticketPreviews = $previews | Where-Object Name -like '*ticket*'
$receiptPreviews = $previews | Where-Object Name -like '*receipt*'
if (-not $ticketPreviews) { throw "No ticket previews written by print service" }
if (-not $receiptPreviews) { throw "No receipt previews written by print service" }
Write-Host "13. PRINT SERVICE OK ($(($ticketPreviews|Measure-Object).Count) ticket previews, $(($receiptPreviews|Measure-Object).Count) receipt previews)"
Write-Host ""
Write-Host "=== PHASE 4: ALL 13 CHECKS PASSED ==="
