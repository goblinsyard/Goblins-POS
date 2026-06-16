# Stops the Goblins Yard POS containers (data is kept).
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
Write-Host 'Stopping Goblins Yard POS...' -ForegroundColor Yellow
docker compose stop
Write-Host 'Stopped. Data is preserved - start again any time.' -ForegroundColor Green
Start-Sleep -Seconds 3
