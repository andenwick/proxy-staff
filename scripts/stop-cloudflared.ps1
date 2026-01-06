param(
  [string]$PidPath = "logs/cloudflared.pid"
)

if (-not (Test-Path $PidPath)) {
  Write-Host "No cloudflared PID file found at $PidPath"
  exit 0
}

$processId = Get-Content $PidPath -ErrorAction SilentlyContinue
if (-not $processId) {
  Remove-Item $PidPath -ErrorAction SilentlyContinue
  Write-Host "PID file was empty."
  exit 0
}

try {
  Stop-Process -Id $processId -Force -ErrorAction Stop
  Remove-Item $PidPath -ErrorAction SilentlyContinue
  Write-Host "Stopped cloudflared (PID $processId)."
} catch {
  Write-Host "Failed to stop cloudflared (PID $processId)."
}
