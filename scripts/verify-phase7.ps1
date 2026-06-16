# Phase 7 verification - reservations, CRM, loyalty, segments
$ErrorActionPreference = 'Stop'
$base = 'http://localhost:3000/api'
function J($o) { $o | ConvertTo-Json -Depth 8 }

$users = Invoke-RestMethod "$base/auth/pin-users"
$mgr = $users | Where-Object { $_.role.name -eq 'Manager' }
$auth = Invoke-RestMethod "$base/auth/login/pin" -Method Post -ContentType 'application/json' -Body (J @{userId=$mgr.id; pin='1111'})
$h = @{ Authorization = "Bearer $($auth.accessToken)" }
Write-Host "1. LOGIN OK"

# owner header for settings change
$oAuth = Invoke-RestMethod "$base/auth/login" -Method Post -ContentType 'application/json' -Body (J @{email='owner@goblinsyard.com'; password='admin123'})
$oh = @{ Authorization = "Bearer $($oAuth.accessToken)" }

# resource for booking
$floor = Invoke-RestMethod "$base/floor" -Headers $h
$bt = ($floor | Where-Object name -eq 'Billiards lounge').resources | Select-Object -First 1

# create a reservation on a random future day (idempotent re-runs) 18:00-20:00
$start = (Get-Date).AddDays((Get-Random -Minimum 3 -Maximum 60)).Date.AddHours(18)
$res = Invoke-RestMethod "$base/reservations" -Method Post -Headers $h -ContentType 'application/json' -Body (J @{
  resourceId=$bt.id; startAt=$start.ToString('o'); endAt=$start.AddHours(2).ToString('o'); partySize=4; guestName='Walk-in Ahmed'; guestPhone='+201112223334'
})
if ($res.status -ne 'CONFIRMED') { throw "Expected CONFIRMED" }
Write-Host "2. RESERVATION CREATED (tomorrow 18:00-20:00, $($bt.name))"

# conflict blocked (overlapping 19:00-21:00)
try {
  Invoke-RestMethod "$base/reservations" -Method Post -Headers $h -ContentType 'application/json' -Body (J @{
    resourceId=$bt.id; startAt=$start.AddHours(1).ToString('o'); endAt=$start.AddHours(3).ToString('o'); partySize=2; guestName='Conflict Guy'
  })
  throw "CONFLICT NOT BLOCKED"
} catch {
  if ($_.Exception.Message -like '*CONFLICT NOT BLOCKED*') { throw }
  Write-Host "3. CONFLICT BLOCKED OK (DoD #5 part 1)"
}

# adjacent booking allowed (16:00-18:00, touching the start boundary; 20:00+ is taken by the seeded reservation)
$adj = Invoke-RestMethod "$base/reservations" -Method Post -Headers $h -ContentType 'application/json' -Body (J @{
  resourceId=$bt.id; startAt=$start.AddHours(-2).ToString('o'); endAt=$start.ToString('o'); partySize=2; guestName='Adjacent Guy'
})
Write-Host "4. ADJACENT SLOT ALLOWED (boundary exclusive)"

# status workflow: seated -> completed
$null = Invoke-RestMethod "$base/reservations/$($res.id)/status/seated" -Method Post -Headers $h
$null = Invoke-RestMethod "$base/reservations/$($res.id)/status/completed" -Method Post -Headers $h
Write-Host "5. STATUS WORKFLOW OK (confirmed -> seated -> completed)"

# no-show auto-release: set grace to 0, create a reservation starting in 2s, wait, sweep
$null = Invoke-RestMethod "$base/settings" -Method Put -Headers $oh -ContentType 'application/json' -Body (J @{'reservation.noShowGraceMinutes'=0})
$soonStart = (Get-Date).ToUniversalTime().AddSeconds(2)
$noshow = Invoke-RestMethod "$base/reservations" -Method Post -Headers $h -ContentType 'application/json' -Body (J @{
  resourceId=$bt.id; startAt=$soonStart.ToString('o'); endAt=$soonStart.AddHours(1).ToString('o'); partySize=2; guestName='No Show Nour'
})
Start-Sleep -Seconds 4
$null = Invoke-RestMethod "$base/reservations/sweep" -Method Post -Headers $h
$timeline = Invoke-RestMethod "$base/reservations/timeline" -Headers $h
$nsNow = $timeline | Where-Object id -eq $noshow.id
if ($nsNow.status -ne 'NO_SHOW') { throw "Expected NO_SHOW after sweep, got $($nsNow.status)" }
$null = Invoke-RestMethod "$base/settings" -Method Put -Headers $oh -ContentType 'application/json' -Body (J @{'reservation.noShowGraceMinutes'=15})
Write-Host "6. NO-SHOW AUTO-RELEASE OK (DoD #5 part 2)"

# CRM: phone lookup + profile with favorites + visit history
$found = Invoke-RestMethod "$base/crm/customers/lookup?phone=%2B20100123" -Headers $h
if (-not $found) { throw "Phone lookup failed" }
$profile = Invoke-RestMethod "$base/crm/customers/$($found[0].id)" -Headers $h
Write-Host "7. CRM LOOKUP + PROFILE OK ($($profile.name), $($profile.visitCount) visits, $(($profile.favorites|Measure-Object).Count) favorites)"

# birthday flag
$flags = Invoke-RestMethod "$base/crm/customers/$($found[0].id)/pos-flags" -Headers $h
Write-Host "8. POS FLAGS OK (birthdayThisWeek=$($flags.birthdayThisWeek), tier=$($flags.tier), points=$($flags.pointsBalance))"

# segments + CSV export
$inactive = Invoke-RestMethod "$base/crm/segments/inactive30" -Headers $h
$top = Invoke-RestMethod "$base/crm/segments/top10pct" -Headers $h
$csv = Invoke-RestMethod "$base/crm/segments/all/export?template=Hi%20%7Bname%7D!%20Visit%20us%20this%20week." -Headers $h
if ($csv -notmatch 'name,phone,message') { throw "CSV header missing" }
Write-Host "9. SEGMENTS OK (inactive30: $(($inactive|Measure-Object).Count), top10pct: $(($top|Measure-Object).Count), CSV export works)"

# feedback on a paid order
$paidOrder = (Invoke-RestMethod "$base/audit?action=shift.open&take=1" -Headers $oh) # placeholder fetch to keep flow
$orders = Invoke-RestMethod "$base/orders/open" -Headers $h
$menu = Invoke-RestMethod "$base/menu" -Headers $h
$water = ($menu | Where-Object name -eq 'Soft drinks').items | Where-Object name -eq 'Water'
$fo = Invoke-RestMethod "$base/orders" -Method Post -Headers $h -ContentType 'application/json' -Body (J @{type='TAKEAWAY'})
$fo = Invoke-RestMethod "$base/orders/$($fo.id)/items" -Method Post -Headers $h -ContentType 'application/json' -Body (J @{items=@(@{itemId=$water.id; quantity=1})})
$pm = Invoke-RestMethod "$base/payment-methods" -Headers $h
$cash = $pm | Where-Object kind -eq 'CASH'
$null = Invoke-RestMethod "$base/orders/$($fo.id)/pay" -Method Post -Headers $h -ContentType 'application/json' -Body (J @{payments=@(@{methodId=$cash.id; amountCents=[int]$fo.totalCents; tenderedCents=[int]$fo.totalCents})})
$fb = Invoke-RestMethod "$base/crm/feedback" -Method Post -Headers $h -ContentType 'application/json' -Body (J @{orderId=$fo.id; rating=5; comment='Great vibes'})
if ($fb.rating -ne 5) { throw "Feedback failed" }
Write-Host "10. FEEDBACK OK (5 stars)"

# public booking availability (no auth)
$avail = Invoke-RestMethod "$base/reservations/public/availability?date=$((Get-Date).AddDays(1).ToString('yyyy-MM-dd'))"
$btAvail = $avail | Where-Object id -eq $bt.id
if (-not $btAvail.busy) { throw "Public availability should show busy slots for $($bt.name)" }
Write-Host "11. PUBLIC BOOKING API OK (unauthenticated, shows $(($btAvail.busy|Measure-Object).Count) busy slots)"

Write-Host ""
Write-Host "=== PHASE 7: ALL 11 CHECKS PASSED ==="
