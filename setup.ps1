#Requires -Version 5.1
<#
.SYNOPSIS
  RFQ Dashboard — Windows setup / update script.
  Installs Docker Desktop if needed, builds the container image, and starts the app.
.NOTES
  Run once for first-time setup. Re-run any time to update to the latest code.
#>

$ErrorActionPreference = "Stop"

$PORT           = 8080
$IMAGE_NAME     = "rfq-dashboard"
$CONTAINER_NAME = "rfq-dashboard"
$SCRIPT_DIR     = Split-Path -Parent $MyInvocation.MyCommand.Path
$APP_DIR        = Join-Path $SCRIPT_DIR "dashboard-app"

function Write-Step { param($msg) Write-Host "`n[*] $msg" -ForegroundColor Cyan }
function Write-Ok   { param($msg) Write-Host "    OK  $msg" -ForegroundColor Green }
function Write-Warn { param($msg) Write-Host "    !!  $msg" -ForegroundColor Yellow }
function Write-Fail { param($msg) Write-Host "`n[X] $msg`n" -ForegroundColor Red; exit 1 }

Clear-Host
Write-Host ""
Write-Host "  ╔════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "  ║    RFQ Dashboard — Setup         ║" -ForegroundColor Cyan
Write-Host "  ╚════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# ── Verify project files are present ─────────────────────────────────────────
Write-Step "Verifying project files..."
if (-not (Test-Path (Join-Path $APP_DIR "Dockerfile"))) {
    Write-Fail "dashboard-app\Dockerfile not found. Make sure setup.ps1 is in the project root."
}
Write-Ok "Project files found"

# ── Step 1: Check for Docker ──────────────────────────────────────────────────
Write-Step "Checking for Docker..."

$dockerCmd = Get-Command docker -ErrorAction SilentlyContinue
if (-not $dockerCmd) {
    Write-Warn "Docker not found."

    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($winget) {
        Write-Host "    Installing Docker Desktop via winget..." -ForegroundColor White
        winget install -e --id Docker.DockerDesktop --silent --accept-source-agreements --accept-package-agreements
    } else {
        Write-Warn "winget not available. Opening Docker Desktop download page..."
        Start-Process "https://www.docker.com/products/docker-desktop/"
        Write-Host ""
        Write-Host "  1. Download and install Docker Desktop from:" -ForegroundColor White
        Write-Host "     https://www.docker.com/products/docker-desktop/" -ForegroundColor Yellow
        Write-Host "  2. Start Docker Desktop and wait for the engine to be ready." -ForegroundColor White
        Write-Host "  3. Re-run this script." -ForegroundColor White
        Write-Host ""
        exit 0
    }

    # Refresh PATH so docker.exe is visible in this session
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH","Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("PATH","User")

    $dockerExe = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    if (Test-Path $dockerExe) { Start-Process $dockerExe }

    Write-Host ""
    Write-Host "  Docker Desktop was just installed." -ForegroundColor White
    Write-Host "  Please start Docker Desktop, wait for it to say 'Engine running'," -ForegroundColor White
    Write-Host "  then re-run this script." -ForegroundColor White
    Write-Host ""
    exit 0
}

Write-Ok "Docker CLI: $(docker --version)"

# ── Step 2: Wait for Docker engine ───────────────────────────────────────────
Write-Step "Checking Docker engine..."

docker info 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Warn "Docker engine not running — attempting to start Docker Desktop..."

    $dockerExe = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    if (Test-Path $dockerExe) {
        Start-Process $dockerExe
    } else {
        Write-Warn "Docker Desktop executable not found at default path. Please start it manually."
    }

    Write-Host "    Waiting for engine (up to 90 s)..." -ForegroundColor White
    $waited = 0
    while ($waited -lt 90) {
        Start-Sleep -Seconds 5
        $waited += 5
        docker info 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) { break }
        Write-Host "    ... $waited s" -ForegroundColor DarkGray
    }

    if ($LASTEXITCODE -ne 0) {
        Write-Fail "Docker engine did not start in time. Open Docker Desktop manually and re-run."
    }
}

Write-Ok "Docker engine is running"

# ── Step 3: Build the image ───────────────────────────────────────────────────
Write-Step "Building Docker image '$IMAGE_NAME' (first run may take a few minutes)..."

docker build -t "${IMAGE_NAME}:latest" $APP_DIR
if ($LASTEXITCODE -ne 0) { Write-Fail "Docker build failed. See output above." }

Write-Ok "Image built: ${IMAGE_NAME}:latest"

# ── Step 4: Replace existing container ────────────────────────────────────────
Write-Step "Starting container..."

docker stop $CONTAINER_NAME 2>&1 | Out-Null
docker rm   $CONTAINER_NAME 2>&1 | Out-Null

docker run -d `
    --name $CONTAINER_NAME `
    -p "${PORT}:80" `
    --restart unless-stopped `
    "${IMAGE_NAME}:latest"

if ($LASTEXITCODE -ne 0) { Write-Fail "Failed to start container." }

Write-Ok "Container '$CONTAINER_NAME' started on port $PORT"

# ── Done ──────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ╔════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "  ║   Dashboard is live!                   ║" -ForegroundColor Green
Write-Host "  ║                                        ║" -ForegroundColor Green
Write-Host "  ║   http://localhost:$PORT                  ║" -ForegroundColor Green
Write-Host "  ╚════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""

Start-Process "http://localhost:$PORT"
