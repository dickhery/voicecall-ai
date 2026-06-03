param(
  [string]$ServiceName = "VoiceCallAI",
  [string]$ProjectRoot = "C:\Projects\voicecall-ai",
  [string]$NssmPath = "C:\Tools\nssm\nssm.exe",
  [string]$Remote = "origin",
  [string]$Branch = "main"
)

$ErrorActionPreference = "Stop"

function Read-DotEnv {
  param([string]$Path)

  $values = @{}
  if (-not (Test-Path $Path)) {
    return $values
  }

  foreach ($line in Get-Content $Path) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#") -or -not $trimmed.Contains("=")) {
      continue
    }

    $parts = $trimmed.Split("=", 2)
    $key = $parts[0].Trim()
    $value = $parts[1].Trim().Trim('"').Trim("'")
    $values[$key] = $value
  }

  return $values
}

function Require-Command {
  param([string]$Name)

  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "$Name was not found on PATH."
  }
}

if (-not (Test-Path $ProjectRoot)) {
  throw "Project root was not found at $ProjectRoot"
}

if (-not (Test-Path $NssmPath)) {
  throw "NSSM was not found at $NssmPath"
}

Require-Command git
Require-Command pnpm
Require-Command node

$ServerDir = Join-Path $ProjectRoot "src\server"
$ServerFile = Join-Path $ServerDir "server.js"
$EnvFile = Join-Path $ServerDir ".env"

if (-not (Test-Path $ServerFile)) {
  throw "Voice server entrypoint was not found at $ServerFile"
}

if (-not (Test-Path $EnvFile)) {
  throw "Missing $EnvFile. Copy src\server\.env.example to src\server\.env and fill it first."
}

Push-Location $ProjectRoot
try {
  Write-Host "Fetching $Remote/$Branch..."
  git fetch $Remote $Branch

  Write-Host "Fast-forwarding local $Branch..."
  git checkout $Branch
  git pull --ff-only $Remote $Branch

  Write-Host "Installing dependencies..."
  pnpm install --prefer-offline

  Write-Host "Checking server syntax..."
  Push-Location $ServerDir
  try {
    node --check server.js
  } finally {
    Pop-Location
  }

  $envValues = Read-DotEnv $EnvFile
  $port = if ($envValues.ContainsKey("PORT") -and $envValues["PORT"]) { $envValues["PORT"] } else { "3000" }
  $hostName = if ($envValues.ContainsKey("HOSTNAME")) { $envValues["HOSTNAME"].Trim().TrimEnd("/") } else { "" }
  $frontendOrigin = if ($envValues.ContainsKey("FRONTEND_ORIGIN")) { $envValues["FRONTEND_ORIGIN"].Trim().TrimEnd("/") } else { "" }
  $frontendUrl = if ($envValues.ContainsKey("FRONTEND_URL")) { $envValues["FRONTEND_URL"].Trim().TrimEnd("/") } else { "" }
  $frontendCanisterId = if ($envValues.ContainsKey("FRONTEND_CANISTER_ID")) { $envValues["FRONTEND_CANISTER_ID"].Trim() } else { "" }

  if (-not $frontendOrigin -or $frontendOrigin -eq "*") {
    if ($frontendCanisterId) {
      $frontendOrigin = "https://$frontendCanisterId.icp0.io"
    } else {
      Write-Warning "FRONTEND_ORIGIN is not restricted. Use * only for temporary local testing."
      $frontendOrigin = "https://voicecallai.online"
    }
  }

  $testOrigins = @()
  if ($frontendOrigin) {
    $testOrigins += ($frontendOrigin -split "," | ForEach-Object { $_.Trim().TrimEnd("/") } | Where-Object { $_ -and $_ -ne "*" })
  }
  if ($frontendUrl) {
    $testOrigins += $frontendUrl
  }
  if ($frontendCanisterId) {
    $testOrigins += "https://$frontendCanisterId.icp0.io"
    $testOrigins += "https://$frontendCanisterId.ic0.app"
  }
  $testOrigins += "https://voicecallai.online"
  $testOrigins += "https://www.voicecallai.online"
  $testOrigins = $testOrigins | Select-Object -Unique

  Write-Host "Ensuring $ServiceName points at this checkout..."
  & $NssmPath set $ServiceName AppDirectory $ServerDir
  & $NssmPath set $ServiceName AppParameters "server.js"

  Write-Host "Restarting $ServiceName with NSSM..."
  & $NssmPath restart $ServiceName
  Start-Sleep -Seconds 3
  & $NssmPath status $ServiceName

  $localUrl = "http://127.0.0.1:$port/health"
  foreach ($origin in $testOrigins) {
    Write-Host "Checking local CORS health: $localUrl from $origin"
    $localResponse = Invoke-WebRequest -Uri $localUrl -Headers @{ Origin = $origin } -UseBasicParsing
    Write-Host "Local HTTP status: $($localResponse.StatusCode)"
    Write-Host "Local Access-Control-Allow-Origin: $($localResponse.Headers["Access-Control-Allow-Origin"])"
    Write-Host $localResponse.Content
    if ($localResponse.Headers["Access-Control-Allow-Origin"] -ne $origin) {
      throw "Local CORS health check did not allow $origin."
    }
  }

  if ($hostName) {
    $publicHost = $hostName -replace "^https?://", ""
    $publicHost = $publicHost -replace "/.*$", ""
    $publicUrl = "https://$publicHost/health"
    foreach ($origin in $testOrigins) {
      Write-Host "Checking public CORS health: $publicUrl from $origin"
      $publicResponse = Invoke-WebRequest -Uri $publicUrl -Headers @{ Origin = $origin } -UseBasicParsing
      Write-Host "Public HTTP status: $($publicResponse.StatusCode)"
      Write-Host "Public Access-Control-Allow-Origin: $($publicResponse.Headers["Access-Control-Allow-Origin"])"
      Write-Host $publicResponse.Content
      if ($publicResponse.Headers["Access-Control-Allow-Origin"] -ne $origin) {
        throw "Public CORS health check did not allow $origin."
      }
    }
  }
} finally {
  Pop-Location
}
