param(
  [string]$ServiceName = "VoiceCallAI",
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$NssmPath = "C:\Tools\nssm\nssm.exe",
  [string]$NodePath = "C:\Program Files\nodejs\node.exe"
)

$ErrorActionPreference = "Stop"

$ServerDir = Join-Path $ProjectRoot "src\server"
$ServerFile = Join-Path $ServerDir "server.js"
$EnvFile = Join-Path $ServerDir ".env"
$LogDir = Join-Path $ProjectRoot "logs"

if (-not (Test-Path $NssmPath)) {
  throw "NSSM was not found at $NssmPath"
}

if (-not (Test-Path $NodePath)) {
  throw "Node.js was not found at $NodePath"
}

if (-not (Test-Path $ServerFile)) {
  throw "Voice server entrypoint was not found at $ServerFile"
}

if (-not (Test-Path $EnvFile)) {
  throw "Missing $EnvFile. Copy src\server\.env.example to src\server\.env and fill it first."
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

$serviceExists = $false
sc.exe query $ServiceName *> $null
if ($LASTEXITCODE -eq 0) {
  $serviceExists = $true
}

if (-not $serviceExists) {
  & $NssmPath install $ServiceName $NodePath "server.js"
}

& $NssmPath set $ServiceName Application $NodePath
& $NssmPath set $ServiceName AppParameters "server.js"
& $NssmPath set $ServiceName AppDirectory $ServerDir
& $NssmPath set $ServiceName DisplayName "VoiceCall AI Node Server"
& $NssmPath set $ServiceName Description "Runs the VoiceCall AI Twilio/xAI bridge."
& $NssmPath set $ServiceName Start SERVICE_AUTO_START
& $NssmPath set $ServiceName AppStdout (Join-Path $LogDir "voicecall-out.log")
& $NssmPath set $ServiceName AppStderr (Join-Path $LogDir "voicecall-err.log")
& $NssmPath set $ServiceName AppRotateFiles 1
& $NssmPath set $ServiceName AppRotateOnline 1
& $NssmPath set $ServiceName AppRotateSeconds 86400
& $NssmPath set $ServiceName AppRotateBytes 10485760
& $NssmPath set $ServiceName AppRestartDelay 5000
& $NssmPath set $ServiceName AppExit Default Restart

sc.exe start $ServiceName
sc.exe queryex $ServiceName
