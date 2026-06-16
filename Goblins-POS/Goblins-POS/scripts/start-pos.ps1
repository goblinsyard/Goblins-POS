# Starts the Goblins Yard POS stack and opens the apps in the browser.
# Safe to run repeatedly - it only starts what is not already running.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host '=== Goblins Yard POS ===' -ForegroundColor Green

# 1. make sure the Docker engine is running
docker info *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Starting Docker Desktop...' -ForegroundColor Yellow
    # Try using the official CLI command to start Docker Desktop (which waits synchronously)
    & docker desktop start
    if ($LASTEXITCODE -ne 0) {
        # Fallback to direct executable invocation if the CLI start failed
        $dd = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
        if (-not (Test-Path $dd)) { Write-Host 'Docker Desktop not found - install it first.' -ForegroundColor Red; pause; exit 1 }
        Start-Process -FilePath $dd -WorkingDirectory (Split-Path $dd)
        $ok = $false
        foreach ($i in 1..60) {
            Start-Sleep -Seconds 3
            docker info *> $null
            if ($LASTEXITCODE -eq 0) { $ok = $true; break }
            Write-Host "  waiting for Docker engine... ($($i*3)s)"
        }
        if (-not $ok) { Write-Host 'Docker engine did not start.' -ForegroundColor Red; pause; exit 1 }
    }
}

# 2. bring the stack up
Write-Host 'Starting POS containers...' -ForegroundColor Yellow
docker compose up -d
if ($LASTEXITCODE -ne 0) { Write-Host 'docker compose failed.' -ForegroundColor Red; pause; exit 1 }

# 3. wait until the web app answers
Write-Host 'Waiting for the POS to come online...' -ForegroundColor Yellow
$up = $false
foreach ($i in 1..30) {
    try {
        $r = Invoke-WebRequest -Uri 'http://localhost:8080/' -UseBasicParsing -TimeoutSec 2
        if ($r.StatusCode -eq 200) { $up = $true; break }
    } catch { Start-Sleep -Seconds 2 }
}
if (-not $up) { Write-Host 'POS did not respond on http://localhost:8080/' -ForegroundColor Red; pause; exit 1 }

# 4. open the apps
Start-Process 'http://localhost:8080/'          # POS
Start-Process 'http://localhost:8080/admin/'    # Back office
Start-Process 'http://localhost:8080/kds/'      # Kitchen display

Write-Host ''
Write-Host 'POS is running:' -ForegroundColor Green
Write-Host '  POS terminal : http://localhost:8080/'
Write-Host '  Back office  : http://localhost:8080/admin/'
Write-Host '  Kitchen/Bar  : http://localhost:8080/kds/'
Start-Sleep -Seconds 4
