# Goblins Yard - restore a backup
# Usage: .\scripts\restore.ps1 -BackupFile backups\goblins-20260611-040000.sql.zip
param([Parameter(Mandatory=$true)][string]$BackupFile)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path $BackupFile)) { throw "Not found: $BackupFile" }
$tmp = Join-Path $env:TEMP 'goblins-restore'
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
Expand-Archive $BackupFile -DestinationPath $tmp
$sql = Get-ChildItem $tmp -Filter '*.sql' | Select-Object -First 1
Write-Host "Restoring $($sql.Name) — this REPLACES current data. Ctrl+C to abort, continuing in 5s..."
Start-Sleep -Seconds 5
Get-Content $sql.FullName -Raw | docker exec -i goblins-pos-db-1 psql -U goblins -d goblins_pos
Write-Host 'Restore complete.'
