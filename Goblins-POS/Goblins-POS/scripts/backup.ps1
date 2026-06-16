# Goblins Yard - database backup (Windows)
# Usage: .\scripts\backup.ps1            -> creates backups\goblins-YYYYMMDD-HHmmss.sql.gz
#        Schedule daily via Task Scheduler pointing at this script.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$dir = Join-Path $root 'backups'
New-Item -ItemType Directory -Force $dir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$file = Join-Path $dir "goblins-$stamp.sql"
docker exec goblins-pos-db-1 pg_dump -U goblins -d goblins_pos --clean --if-exists > $file
if ($LASTEXITCODE -ne 0) { throw 'pg_dump failed' }
# compress
Compress-Archive -Path $file -DestinationPath "$file.zip" -Force
Remove-Item $file
# keep last 30
Get-ChildItem $dir -Filter 'goblins-*.zip' | Sort-Object Name -Descending | Select-Object -Skip 30 | Remove-Item -Confirm:$false
Write-Host "Backup written: $file.zip"
