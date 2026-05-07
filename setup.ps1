$ErrorActionPreference = "Stop"

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Ensure-Command {
  param(
    [string]$Command,
    [string]$InstallHint
  )

  if (-not (Get-Command $Command -ErrorAction SilentlyContinue)) {
    throw "$Command is required. $InstallHint"
  }
}

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Backend = Join-Path $Root "backend"
$Frontend = Join-Path $Root "frontend"
$BackendEnv = Join-Path $Backend ".env"

Write-Step "Checking local tools"
Ensure-Command "node" "Install Node.js LTS from https://nodejs.org/"
Ensure-Command "npm" "Install Node.js LTS from https://nodejs.org/"

Write-Host "Node: $(node --version)"
Write-Host "npm:  $(npm --version)"

Write-Step "Installing backend dependencies"
Push-Location $Backend
if (Test-Path "package-lock.json") {
  npm ci
} else {
  npm install
}
Pop-Location

Write-Step "Installing frontend dependencies"
Push-Location $Frontend
if (Test-Path "package-lock.json") {
  npm ci
} else {
  npm install
}
Pop-Location

Write-Step "Preparing backend environment"
if (-not (Test-Path $BackendEnv)) {
  @"
# Required: PostgreSQL connection string.
# Example:
# DATABASE_URL="postgresql://postgres:password@localhost:5432/medrota?schema=public"
DATABASE_URL=""

# Used to sign login tokens. Replace this with a long random string.
JWT_SECRET="change-me-before-running"

# Backend API port.
PORT=3000
"@ | Set-Content -Path $BackendEnv -Encoding UTF8

  Write-Host "Created backend\.env. Edit DATABASE_URL before running the app." -ForegroundColor Yellow
} else {
  Write-Host "backend\.env already exists; leaving it unchanged."
}

Write-Step "Setting up Prisma"
Push-Location $Backend
npm exec prisma generate

$EnvText = Get-Content $BackendEnv -Raw
$HasDatabaseUrl = $EnvText -match 'DATABASE_URL\s*=\s*"?[^"\r\n]+' -and $EnvText -notmatch 'DATABASE_URL\s*=\s*""'

if ($HasDatabaseUrl) {
  npm exec prisma migrate deploy
} else {
  Write-Host "Skipped database migrations because backend\.env has no DATABASE_URL yet." -ForegroundColor Yellow
}
Pop-Location

Write-Step "Done"
Write-Host "To run the app, open two PowerShell windows:"
Write-Host "  cd backend; npm run dev"
Write-Host "  cd frontend; npm run dev"
Write-Host ""
Write-Host "Frontend: http://localhost:5173"
Write-Host "Backend:  http://localhost:3000/api/health"
