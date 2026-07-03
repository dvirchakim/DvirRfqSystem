#Requires -Version 5.1
<#
.SYNOPSIS
  RFQ Dashboard — Windows setup / update script.
  Installs Docker Desktop if needed, then builds and starts the full stack
  (dashboard + AI-agent backend + PostgreSQL) via docker compose.
.NOTES
  Run once for first-time setup. Re-run any time to update to the latest code.
  Creates a .env with generated secrets on first run; never overwrites it.
#>

$ErrorActionPreference = "Continue"

$PORT        = 8080
$SCRIPT_DIR  = Split-Path -Parent $MyInvocation.MyCommand.Path
$APP_DIR     = Join-Path $SCRIPT_DIR "dashboard-app"
$COMPOSE     = Join-Path $SCRIPT_DIR "docker-compose.yml"
$ENV_FILE    = Join-Path $SCRIPT_DIR ".env"

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
if (-not (Test-Path $COMPOSE)) {
    Write-Fail "docker-compose.yml not found. Make sure setup.ps1 is in the project root."
}
Write-Ok "Project files found"

# ── Ensure a .env exists (generated once, never overwritten) ─────────────────
Write-Step "Checking configuration (.env)..."
if (-not (Test-Path $ENV_FILE)) {
    function New-Secret { -join ([guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')) }
    $pgPw    = New-Secret
    $agentPw = New-Secret
    $apiTok  = New-Secret
    @(
        "POSTGRES_PASSWORD=$pgPw",
        "AGENT_DB_PASSWORD=$agentPw",
        "BACKEND_API_TOKEN=$apiTok",
        "ALLOW_UNAUTHENTICATED=false",
        "# Optional: set your OpenRouter key here, or leave blank and paste it in Settings -> AI Agent.",
        "OPENROUTER_API_KEY=",
        "OPENROUTER_MODEL=anthropic/claude-3-haiku",
        "PORT=$PORT"
    ) | Set-Content -Path $ENV_FILE -Encoding ascii
    Write-Ok "Generated .env with fresh secrets — the AI Agent authenticates to the backend automatically, nothing to paste anywhere"
} else {
    Write-Ok ".env already exists — leaving it untouched"
    # Read PORT from the existing .env so the final URL is correct.
    $portLine = Select-String -Path $ENV_FILE -Pattern '^\s*PORT\s*=\s*(\d+)' -ErrorAction SilentlyContinue
    if ($portLine) { $PORT = [int]$portLine.Matches[0].Groups[1].Value }
}

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

# ── Step 3: Build & start the full stack via docker compose ──────────────────
Write-Step "Building and starting the stack (dashboard + AI agent + database)..."
Write-Host "    First run may take a few minutes while images build." -ForegroundColor White

Push-Location $SCRIPT_DIR
try {
    docker compose up -d --build
    $composeExit = $LASTEXITCODE
} finally {
    Pop-Location
}
if ($composeExit -ne 0) { Write-Fail "docker compose failed. See output above." }

Write-Ok "Stack is up (frontend, backend, postgres)"

# ── Done ──────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ╔════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "  ║   Dashboard is live!                   ║" -ForegroundColor Green
Write-Host "  ║                                        ║" -ForegroundColor Green
Write-Host "  ║   http://localhost:$PORT                  ║" -ForegroundColor Green
Write-Host "  ╚════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""

Start-Process "http://localhost:$PORT"
