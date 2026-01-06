param(
  [int]$Port = 3000,
  [string]$Hostname = "localhost",
  [string]$LogPath = "logs/cloudflared.log",
  [int]$TimeoutSeconds = 30
)

$logDir = Split-Path $LogPath
if ($logDir -and -not (Test-Path $logDir)) {
  New-Item -ItemType Directory -Path $logDir | Out-Null
}

$pidPath = "logs/cloudflared.pid"
$stdoutPath = $LogPath
$stderrPath = [System.IO.Path]::ChangeExtension($LogPath, ".err.log")

if (Test-Path $pidPath) {
  $existingPid = Get-Content $pidPath -ErrorAction SilentlyContinue
  if ($existingPid) {
    try {
      $proc = Get-Process -Id $existingPid -ErrorAction Stop
      Write-Host "cloudflared already running (PID $existingPid). Stop it first."
      exit 1
    } catch {
      Remove-Item $pidPath -ErrorAction SilentlyContinue
    }
  }
}

$args = @("tunnel", "--url", "http://$Hostname`:$Port", "--no-autoupdate")
try {
  $process = Start-Process -FilePath "cloudflared" -ArgumentList $args -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
} catch {
  Write-Host "Failed to start cloudflared. Check that it is installed and on PATH."
  exit 1
}

if (-not $process -or -not $process.Id) {
  Write-Host "Failed to start cloudflared."
  exit 1
}

$process.Id | Set-Content $pidPath
Write-Host "cloudflared started (PID $($process.Id)). Waiting for public URL..."

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$url = $null

while ((Get-Date) -lt $deadline) {
  if (Test-Path $stdoutPath) {
    $log = Get-Content $stdoutPath -Raw
    if ($log -match "https://[a-z0-9-]+\\.trycloudflare\\.com") {
      $url = $Matches[0]
      break
    }
  }
  if (Test-Path $stderrPath) {
    $err = Get-Content $stderrPath -Raw
    if ($err -match "https://[a-z0-9-]+\\.trycloudflare\\.com") {
      $url = $Matches[0]
      break
    }
  }
  Start-Sleep -Milliseconds 500
}

if (-not $url) {
  Write-Host "Public URL not found yet. Check $LogPath for details."
  exit 0
}

Write-Host "Public URL: $url"
Write-Host "Webhook base: $url/webhooks/whatsapp"
