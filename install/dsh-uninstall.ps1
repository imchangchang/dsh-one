<#
.SYNOPSIS
  dsh-one uninstaller for Windows: remove the dsh installation and restore the
  machine to the "dsh not installed" state (handy to retest the install flow).

.DESCRIPTION
  Removes:
    - running dsh node processes (the CLI under ~/.dsh, matched by executable path)
    - ~/.dsh (portable Node, dsh CLI, profiles, settings.yaml)
    - the installer's user PATH entry (~/.dsh/node-x64)
  Before deleting, ~/.dsh is backed up to %TEMP%\dsh-backup-<timestamp> because
  settings.yaml may hold API keys. No administrator elevation needed (all paths
  are under the user profile); dsh processes started by another user would
  survive the process kill step.

.EXAMPLE
  irm https://raw.githubusercontent.com/imchangchang/dsh-one/main/install/dsh-uninstall.ps1 | iex

.NOTES
  Kept pure ASCII: PowerShell 5.1 reads BOM-less .ps1 as ANSI/GBK and
  non-ASCII corrupts parsing. Unrelated to dsh itself -- unofficial tooling
  maintained by the dsh-one repo.
#>

$ErrorActionPreference = 'Continue'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

function Write-Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }

$dshDir  = Join-Path $env:USERPROFILE '.dsh'
$nodeDir = Join-Path $dshDir 'node-x64'

# 1. Kill running dsh node processes (they lock files and make the removal fail).
Write-Step "Stopping running dsh processes"
$dshProcs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.ExecutablePath -and $_.ExecutablePath -like "$dshDir*" }
if ($dshProcs) {
  foreach ($p in $dshProcs) {
    Write-Step "Killing dsh node pid $($p.ProcessId) ($($p.CommandLine))"
    & taskkill /PID $p.ProcessId /T /F 2>$null | Out-Null
  }
  Start-Sleep -Seconds 1
} else {
  Write-Step "No running dsh processes"
}

# 2. Backup, then remove ~/.dsh (config may hold API keys; backup first).
Write-Step "Backing up and removing $dshDir"
$backup = Join-Path $env:TEMP ("dsh-backup-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
if (Test-Path -LiteralPath $dshDir) {
  # robocopy (not Copy-Item): npm trees easily exceed the 260-char MAX_PATH,
  # where Copy-Item fails with DirectoryNotFoundException mid-copy.
  robocopy $dshDir $backup /E /R:1 /W:1 /NFL /NDL /NJH /NJS | Out-Null
  if ($LASTEXITCODE -ge 8) {
    Write-Host "warn: backup incomplete (robocopy exit $LASTEXITCODE); removing anyway" -ForegroundColor Yellow
  }
  Remove-Item -LiteralPath $dshDir -Recurse -Force
  Write-Step "Backed up to: $backup (delete it once you no longer need the old config)"
} else {
  Write-Step "~/.dsh not present"
}

# 3. Remove the installer's user PATH entry (exact match, other entries kept).
Write-Step "Cleaning user PATH"
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($userPath -and ($userPath.Split(';') -contains $nodeDir)) {
  $newPath = (($userPath -split ';') | Where-Object { $_ -and $_ -ne $nodeDir }) -join ';'
  [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
  Write-Step "Removed from user PATH: $nodeDir"
} else {
  Write-Step "No $nodeDir entry in user PATH"
}

# 4. Verify the clean state.
Write-Step "Verifying"
Write-Host ("~/.dsh exists         : " + (Test-Path -LiteralPath $dshDir))
Write-Host ("dsh on PATH           : " + [bool](Get-Command dsh -ErrorAction SilentlyContinue))
Write-Host ("node on PATH          : " + [bool](Get-Command node -ErrorAction SilentlyContinue))
$p = [Environment]::GetEnvironmentVariable('Path', 'User')
Write-Host ("user PATH has node-x64: " + [bool]($p -match 'node-x64'))
Write-Host ""
Write-Host "Machine is back to the 'dsh not installed' state. Reinstall anytime with:" -ForegroundColor Green
Write-Host "  irm https://raw.githubusercontent.com/imchangchang/dsh-one/main/install/dsh-install.ps1 | iex"
