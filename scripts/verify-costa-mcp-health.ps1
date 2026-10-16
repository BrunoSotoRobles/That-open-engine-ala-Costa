# Costa MCP health check - run after restarting Claude.
# Usage: powershell -ExecutionPolicy Bypass -File scripts\verify-costa-mcp-health.ps1

$ErrorActionPreference = "Continue"
$fail = 0

function Fail($msg) {
  Write-Host "FAIL: $msg" -ForegroundColor Red
  $script:fail++
}

function Pass($msg) {
  Write-Host "PASS: $msg" -ForegroundColor Green
}

function Warn($msg) {
  Write-Host "WARN: $msg" -ForegroundColor Yellow
}

Write-Host "=== Costa MCP health check $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ===" -ForegroundColor Cyan

$lockPath = Join-Path $env:LOCALAPPDATA "CostaMCP\costa-mcp.instance.json"
$lockPid = $null
$lockPort = $null
if (Test-Path $lockPath) {
  try {
    $lock = Get-Content $lockPath -Raw | ConvertFrom-Json
    $lockPid = [int]$lock.pid
    $lockPort = [int]$lock.port
    Pass "Lock file exists pid=$lockPid port=$lockPort"
  } catch {
    Fail "Lock file unreadable at $lockPath"
  }
} else {
  Fail "No lock file at $lockPath (MCP may not be running)"
}

$portLines = netstat -ano | Select-String "LISTENING" | Select-String ":8081"
$listenPids = @()
foreach ($line in $portLines) {
  $parts = ($line.ToString()).Trim() -split '\s+'
  $listenPids += [int]$parts[-1]
}
$listenPids = $listenPids | Select-Object -Unique

if ($listenPids.Count -eq 0) {
  Fail "Nothing LISTENING on port 8081"
} elseif ($listenPids.Count -eq 1) {
  Pass "Exactly one LISTENING pid on 8081: $($listenPids[0])"
} else {
  Fail "Multiple LISTENING on 8081: $($listenPids -join ', ')"
}

if ($null -ne $lockPid -and $listenPids.Count -eq 1 -and $listenPids[0] -ne $lockPid) {
  Warn "Lock pid $lockPid != listener pid $($listenPids[0]) (tsx parent/child is OK if worker holds port)"
}

$mcpAll = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match 'mcp-server\\main\.ts' }
$mcpWorkers = $mcpAll | Where-Object { $_.CommandLine -match 'preflight|loader\.mjs' }
$mcpCli = $mcpAll | Where-Object { $_.CommandLine -match 'cli\.mjs' }

Write-Host "main.ts processes: total=$($mcpAll.Count) cli=$($mcpCli.Count) worker=$($mcpWorkers.Count)"

$logPath = Join-Path $env:LOCALAPPDATA "Claude\logs\mcp-server-costa-mcp.log"
$logTail = @()
if (Test-Path $logPath) {
  $logTail = @(Get-Content $logPath -Tail 80)
}

if ($mcpWorkers.Count -gt 1) {
  $hasPrimary = @($logTail | Select-String "Bridge primary").Count -gt 0
  $hasSecondary = @($logTail | Select-String "Bridge secondary").Count -gt 0
  $relayOk = (
    $mcpWorkers.Count -eq 2 -and
    $listenPids.Count -eq 1 -and
    ($hasPrimary -or $hasSecondary)
  )
  if ($relayOk) {
    Warn "Two MCP workers ($($mcpWorkers.Count)) - Claude primary+secondary relay (normal if ping works)"
  } else {
    Fail "More than one MCP worker: $($mcpWorkers.Count)"
  }
} elseif ($mcpWorkers.Count -eq 1) {
  Pass "Single MCP worker pid=$($mcpWorkers[0].ProcessId)"
} else {
  $mcpAllArr = @($mcpAll)
  if ($mcpAllArr.Count -ge 1) {
    Pass "MCP processes running, count=$($mcpAllArr.Count) (cli+worker)"
  } else {
    Warn "No MCP processes detected"
  }
}

if ($logTail.Count -gt 0) {
  $tail = $logTail
  $bridgeFailed = @($tail | Select-String "WebSocket bridge failed")
  $duplicateExit = @($tail | Select-String "Exiting duplicate")
  $lockAcquired = @($tail | Select-String "Bridge primary|Instance lock acquired")
  if ($bridgeFailed.Count -gt 0) {
    Fail "Log tail has WebSocket bridge failed, count=$($bridgeFailed.Count)"
  } else {
    Pass "No WebSocket bridge failed in last 40 log lines"
  }
  $coworkFail = @($tail | Select-String "Couldn.t start for Cowork")
  if ($coworkFail.Count -gt 0) {
    Fail "Log has Cowork/Code MCP start failure, count=$($coworkFail.Count)"
  } else {
    Pass "No Cowork/Code MCP start failure in last 40 log lines"
  }
  $toolsList = @($tail | Select-String "tools/list")
  if ($toolsList.Count -gt 0) {
    Pass "Claude requested tools/list recently"
  } else {
    Warn "No tools/list in log tail - costa-mcp may not be connected to this chat"
  }
  if ($lockAcquired.Count -gt 0 -or ($tail | Select-String "Bridge primary")) {
    Pass "Log shows bridge primary or lock"
  } elseif ($tail | Select-String "Bridge secondary") {
    Pass "Log shows bridge secondary (relay mode)"
  } else {
    Warn "Restart Claude after pulling this fix"
  }
  if ($duplicateExit.Count -gt 0) {
    Warn "Old log lines show Exiting duplicate - update main.ts and restart Claude"
  }
} else {
  Warn "Claude log not found: $logPath"
}

$est = netstat -ano | Select-String "ESTABLISHED" | Select-String ":8081"
if ($est) {
  Pass "Browser/client ESTABLISHED on 8081"
} else {
  Warn "No ESTABLISHED client on 8081 - F5 CostaBIM before Claude tools"
}

Write-Host ""
if ($fail -eq 0) {
  Write-Host "RESULT: HEALTHY" -ForegroundColor Green
  Write-Host "Next: test costa_ping_store_connection in Claude."
  exit 0
} else {
  Write-Host "RESULT: UNHEALTHY - failure count $fail" -ForegroundColor Red
  Write-Host "Fix: quit Claude, kill node.exe with mcp-server\main.ts, reopen Claude, F5 CostaBIM, run this script again."
  exit 1
}
