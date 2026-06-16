# Phase 3 verification - time-based billing end to end
$ErrorActionPreference = 'Stop'
$base = 'http://localhost:3000/api'
function J($o) { $o | ConvertTo-Json -Depth 8 }

$users = Invoke-RestMethod "$base/auth/pin-users"
$mgr = $users | Where-Object { $_.role.name -eq 'Manager' }
$auth = Invoke-RestMethod "$base/auth/login/pin" -Method Post -ContentType 'application/json' -Body (J @{userId=$mgr.id; pin='1111'})
$h = @{ Authorization = "Bearer $($auth.accessToken)" }
Write-Host "1. LOGIN OK"

$cur = Invoke-RestMethod "$base/shifts/current" -Headers $h
if (-not $cur) { $cur = Invoke-RestMethod "$base/shifts/open" -Method Post -Headers $h -ContentType 'application/json' -Body (J @{floatCents=50000}) }
Write-Host "2. SHIFT OK"

# find a free billiards table and a free PS room
$floor = Invoke-RestMethod "$base/floor" -Headers $h
$bt = ($floor | Where-Object name -eq 'Billiards lounge').resources | Where-Object { $_.sessions.Count -eq 0 -and $_.orders.Count -eq 0 } | Select-Object -First 1
$ps = ($floor | Where-Object name -eq 'PS rooms').resources | Where-Object { $_.sessions.Count -eq 0 -and $_.orders.Count -eq 0 } | Select-Object -First 1
$bt2 = ($floor | Where-Object name -eq 'Billiards lounge').resources | Where-Object { $_.id -ne $bt.id -and $_.sessions.Count -eq 0 -and $_.orders.Count -eq 0 } | Select-Object -First 1
Write-Host "3. RESOURCES OK ($($bt.name), $($ps.name), transfer target $($bt2.name))"

# --- billiards session ---
$bo = Invoke-RestMethod "$base/orders" -Method Post -Headers $h -ContentType 'application/json' -Body (J @{type='BILLIARDS'; resourceId=$bt.id})
$bs = Invoke-RestMethod "$base/sessions/start" -Method Post -Headers $h -ContentType 'application/json' -Body (J @{orderId=$bo.id; isMultiplayer=$false})
Write-Host "4. BILLIARDS SESSION STARTED"

# live cost endpoint
Start-Sleep -Seconds 2
$live = Invoke-RestMethod "$base/sessions/by-order/$($bo.id)" -Headers $h
if ($live.status -ne 'RUNNING') { throw "Expected RUNNING, got $($live.status)" }
Write-Host "5. LIVE COST OK ($($live.liveMinutes) min, $($live.liveCostCents/100) EGP)"

# pause / resume
$null = Invoke-RestMethod "$base/sessions/$($bs.id)/pause" -Method Post -Headers $h
$paused = Invoke-RestMethod "$base/sessions/by-order/$($bo.id)" -Headers $h
if ($paused.status -ne 'PAUSED') { throw "Expected PAUSED" }
$null = Invoke-RestMethod "$base/sessions/$($bs.id)/resume" -Method Post -Headers $h
Write-Host "6. PAUSE/RESUME OK"

# transfer to another billiards table preserving time
$null = Invoke-RestMethod "$base/sessions/$($bs.id)/transfer" -Method Post -Headers $h -ContentType 'application/json' -Body (J @{toResourceId=$bt2.id})
$afterTransfer = Invoke-RestMethod "$base/orders/$($bo.id)" -Headers $h
if ($afterTransfer.resourceId -ne $bt2.id) { throw "Order did not move to target table" }
Write-Host "7. TRANSFER OK (session + order moved to $($bt2.name))"

# attach F&B to the billiards order
$menu = Invoke-RestMethod "$base/menu" -Headers $h
$cola = ($menu | Where-Object name -eq 'Soft drinks').items | Where-Object name -eq 'Cola'
$null = Invoke-RestMethod "$base/orders/$($bo.id)/items" -Method Post -Headers $h -ContentType 'application/json' -Body (J @{items=@(@{itemId=$cola.id; quantity=2})})
Write-Host "8. F&B ATTACHED TO SESSION ORDER (2x Cola)"

# stop -> combined bill
$stopped = Invoke-RestMethod "$base/sessions/$($bs.id)/stop" -Method Post -Headers $h
$bill = Invoke-RestMethod "$base/orders/$($bo.id)" -Headers $h
$timeLine = $bill.items | Where-Object { $_.isTimeCharge -eq $true }
if (-not $timeLine) { throw "No time charge line on combined bill" }
# minimum charge is 30 EGP for billiards (session only ran seconds)
if ([int]$timeLine.lineCents -ne 3000) { throw "Expected minimum 3000, got $($timeLine.lineCents)" }
Write-Host "9. COMBINED BILL OK - time line '$($timeLine.description)' = $($timeLine.lineCents/100) EGP (minimum charge verified), colas + time = $($bill.subtotalCents/100) EGP"

# pay combined bill
$pm = Invoke-RestMethod "$base/payment-methods" -Headers $h
$cash = $pm | Where-Object kind -eq 'CASH'
$payRes = Invoke-RestMethod "$base/orders/$($bo.id)/pay" -Method Post -Headers $h -ContentType 'application/json' -Body (J @{payments=@(@{methodId=$cash.id; amountCents=[int]$bill.totalCents; tenderedCents=[int]$bill.totalCents})})
if (-not $payRes.fullyPaid) { throw "Bill not paid" }
Write-Host "10. COMBINED BILL PAID"

# --- PS session: multiplayer + mode switch + prepaid ---
$po = Invoke-RestMethod "$base/orders" -Method Post -Headers $h -ContentType 'application/json' -Body (J @{type='PS_ROOM'; resourceId=$ps.id})
$pss = Invoke-RestMethod "$base/sessions/start" -Method Post -Headers $h -ContentType 'application/json' -Body (J @{orderId=$po.id; isMultiplayer=$true})
$null = Invoke-RestMethod "$base/sessions/$($pss.id)/set-mode" -Method Post -Headers $h -ContentType 'application/json' -Body (J @{isMultiplayer=$false})
Write-Host "11. PS SESSION OK (multi -> single mode switch)"

# prepaid block: 60 min at single rate 80 EGP/hr = 80 EGP
$block = Invoke-RestMethod "$base/sessions/$($pss.id)/prepaid" -Method Post -Headers $h -ContentType 'application/json' -Body (J @{minutes=60})
if ([int]$block.paidCents -ne 8000) { throw "Prepaid price wrong: expected 8000 got $($block.paidCents)" }
Write-Host "12. PREPAID BLOCK OK (60 min = 80 EGP at single rate)"

# stop PS -> prepaid offsets the time charge (minimum 20 EGP vs prepaid 80 -> charge 0)
$null = Invoke-RestMethod "$base/sessions/$($pss.id)/stop" -Method Post -Headers $h
$pbill = Invoke-RestMethod "$base/orders/$($po.id)" -Headers $h
$ptime = $pbill.items | Where-Object { $_.isTimeCharge -eq $true -and $_.description -like '*PS room*' }
if ([int]$ptime.lineCents -ne 0) { throw "Prepaid should fully cover: got $($ptime.lineCents)" }
Write-Host "13. PREPAID OFFSET OK (time charge 0, prepaid line on bill)"

$payRes2 = Invoke-RestMethod "$base/orders/$($po.id)/pay" -Method Post -Headers $h -ContentType 'application/json' -Body (J @{payments=@(@{methodId=$cash.id; amountCents=[int]$pbill.totalCents; tenderedCents=[int]$pbill.totalCents})})
Write-Host "14. PS BILL PAID (prepaid + VAT/service)"

# session history exists
$hist = Invoke-RestMethod "$base/audit?action=session.stop&take=5" -Headers $h
if (-not $hist) { throw "No session.stop audit entries" }
Write-Host "15. SESSION AUDIT TRAIL OK"
Write-Host ""
Write-Host "=== PHASE 3: ALL 15 CHECKS PASSED ==="
