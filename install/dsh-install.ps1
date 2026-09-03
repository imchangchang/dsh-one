<#
.SYNOPSIS
  One-click dsh (DeepSeek Harness) installer for Windows (PowerShell 5.1+).

.DESCRIPTION
  dsh is installed from npm, so this script makes sure the prerequisites
  exist (Node.js + npm + pnpm), then installs @deepseek-ai/dsh globally.
  Everything is self-detected: OS/architecture, PowerShell version, TLS,
  disk space, existing Node.js/pnpm/git/winget. A compatible Node on PATH
  (>= 22.19, or >= 24) is reused; otherwise a portable Node LTS is downloaded
  into DSH_INSTALL_DIR and prepended to the user PATH - no admin required.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File install-dsh.ps1

.EXAMPLE
  irm https://<host>/install-dsh.ps1 | iex

.NOTES
  Optional env:
    DSH_INSTALL_DIR    base dir, default %USERPROFILE%\.dsh
    DSH_NO_MODIFY_PATH skip user PATH modification when set to a non-empty value
    DSH_NODE_VERSION   pin an exact Node version, e.g. "22.19.1"
    DSH_SKIP_GIT       skip the best-effort git install when set to a non-empty value
                       (git is only needed for git-hosted plugins)

  git itself is optional: dsh core, web UI, and headless runs work without it.
#>

$ErrorActionPreference = 'Stop'

# PowerShell 5.1 on older Windows may not negotiate TLS 1.2 by default.
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$DshBase      = if ($env:DSH_INSTALL_DIR)    { $env:DSH_INSTALL_DIR }    else { Join-Path $env:USERPROFILE '.dsh' }
$DshNoPath    = $env:DSH_NO_MODIFY_PATH
$DshNodePin   = $env:DSH_NODE_VERSION
$DshSkipGit   = $env:DSH_SKIP_GIT
# Official Node dist + npmmirror mirror (tried in order; auto fallback on network/CDN failures).
$NodeDistBases = @(
  'https://nodejs.org/dist',
  'https://registry.npmmirror.com/-/binary/node'
)
$NodeMinMajor = 22
$NodeMinMinor = 19

function Write-Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Warn($msg)       { Write-Host "warn: $msg" -ForegroundColor Yellow }
function Die($msg)        { Write-Host "error: $msg" -ForegroundColor Red; exit 1 }

# ---------- self detection ----------

function Get-DshArch {
  # PowerShell 7+ (.NET Core) uses RuntimeInformation; PowerShell 5.1
  # falls back to environment variables.
  $rawArch = try {
    [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
  } catch {
    # WOW64: 32-bit PS on 64-bit Windows. PROCESSOR_ARCHITEW6432 is only set there.
    if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
  }
  switch ($rawArch) {
    'X64'   { 'x64' }
    'AMD64' { 'x64' }
    'Arm64' { 'arm64' }
    'ARM64' { 'arm64' }
    default { Die "unsupported architecture: $rawArch (dsh needs 64-bit Windows)" }
  }
}

function Test-IsAdmin {
  try {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $p  = New-Object Security.Principal.WindowsPrincipal($id)
    return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  } catch { return $false }
}

function Split-NodeVersion([string]$text) {
  $m = [regex]::Match($text, '^v?(\d+)\.(\d+)\.(\d+)')
  if (-not $m.Success) { return $null }
  return ,@([int]$m.Groups[1].Value, [int]$m.Groups[2].Value, [int]$m.Groups[3].Value)
}

# dsh requires Node ^22.19.0 || >=24.0.0 (repo engines field): 22.x >= 22.19,
# or any 24+, but NOT 23.x.
function Test-NodeCompatible($ver) {
  $v = Split-NodeVersion $ver
  if (-not $v) { return $false }
  $major = $v[0]; $minor = $v[1]
  if ($major -eq $NodeMinMajor) { return ($minor -ge $NodeMinMinor) }
  return ($major -ge 24)
}

function Add-ToUserPath([string]$dir) {
  if ($DshNoPath) { Write-Step "Skipping PATH update (DSH_NO_MODIFY_PATH set)"; return }
  $current = [Environment]::GetEnvironmentVariable('Path', 'User')
  if ($current -and ($current.Split(';') -contains $dir)) {
    Write-Step "$dir already in user PATH"
    return
  }
  # Prepend so a portable Node shadows an older system Node.
  $newPath = if ($current) { "$dir;$current" } else { $dir }
  [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
  Write-Step "Added $dir to user PATH (open a new terminal for it to take effect)"
}

function Test-DiskSpace([string]$path, [long]$requiredMb) {
  try {
# Get-PSDrive (NOT [System.IO.DriveInfo]::GetDriveInfo -- that static method does not
# exist; PS 5.1/7 both fail with "method not found"). Check free space of the drive.
    $drive = Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Root -and $path.StartsWith($_.Root, [System.StringComparison]::OrdinalIgnoreCase) } | Select-Object -First 1
    if (-not $drive) { return }
    if ($drive.Free -lt ($requiredMb * 1MB)) { Die "not enough disk space on $($drive.Name) (need $requiredMb MB)" }
  } catch { Warn "could not check disk space: $($_.Exception.Message)" }
}

# ---------- Node.js ----------

function Get-NodeOnPath {
  $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
  if (-not $nodeCmd) { return $null }
  try {
    $raw = & $nodeCmd.Source --version 2>$null
    if ($LASTEXITCODE -ne 0) { return $null }
    $ver = ([string]$raw).Trim()
    if (Split-NodeVersion $ver) { return @{ Version = $ver; Dir = Split-Path $nodeCmd.Source -Parent } }
  } catch { }
  return $null
}

function Get-NodeDownloadVersion {
  if ($DshNodePin) {
    if (-not (Split-NodeVersion $DshNodePin)) { Die "bad DSH_NODE_VERSION: $DshNodePin" }
    return $DshNodePin
  }
  foreach ($base in $NodeDistBases) {
    try {
      Write-Step "Resolving latest Node LTS from $base/index.json"
      $index = Invoke-RestMethod "$base/index.json" -Method Get
      foreach ($entry in $index) {
        if ($entry.lts -ne $false) {
          $ver = ([string]$entry.version).TrimStart('v')
          if (Test-NodeCompatible "v$ver") { return $ver }
        }
      }
      Die "no Node LTS version satisfying ^$NodeMinMajor.$NodeMinMinor.0 found"
    } catch { Warn "version resolution failed from ${base}: $($_.Exception.Message)" }
  }
  Die "could not resolve the latest Node LTS from any mirror"
}

# Download from each mirror in order; Die only when all fail.
function Invoke-DownloadMirrored([string[]]$urls, [string]$dest) {
  foreach ($u in $urls) {
    try {
      Invoke-WebRequest $u -OutFile $dest -UseBasicParsing
      return
    } catch {
      Warn "download failed from $u ($($_.Exception.Message)); trying the next source"
    }
  }
  Die "download failed from all mirrors: $($urls -join ', ')"
}

function Install-PortableNode([string]$version, [string]$arch) {
  $nodeHome = Join-Path $DshBase "node-$arch"
  $zip      = Join-Path $DshBase "node-v$version-win-$arch.zip"
  $extract  = Join-Path $DshBase ".node-extract"
  $inner    = Join-Path $extract "node-v$version-win-$arch"

  if (Test-Path -LiteralPath (Join-Path $nodeHome 'node.exe')) {
    Write-Step "Portable Node already installed at $nodeHome"
    return $nodeHome
  }

  Write-Step "Downloading Node $version (win-$arch)"
  $zipUrls = foreach ($base in $NodeDistBases) { "$base/v$version/node-v$version-win-$arch.zip" }
  Invoke-DownloadMirrored $zipUrls $zip

  Write-Step "Verifying SHA256"
  $sums = $null
  foreach ($base in $NodeDistBases) {
    try {
      $sums = Invoke-WebRequest "$base/v$version/SHASUMS256.txt" -UseBasicParsing
      break
    } catch { Warn "checksum list fetch failed from ${base}: $($_.Exception.Message)" }
  }
  if (-not $sums) { Die "could not fetch SHASUMS256.txt from any mirror" }
  $expected = $null
  foreach ($raw in ([string]$sums.Content -split "`n")) {
    $line = $raw.Trim()
    if ($line -match "^([0-9a-f]{64})\s{2}$([regex]::Escape("node-v$version-win-$arch.zip"))$") {
      $expected = $Matches[1].ToLower(); break
    }
  }
  if (-not $expected) { Die "no checksum entry for node-v$version-win-$arch.zip in SHASUMS256.txt" }
  $actual = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLower()
  if ($actual -ne $expected) { Die "checksum mismatch: expected $expected, got $actual" }

  if (Test-Path -LiteralPath $extract) { Remove-Item -LiteralPath $extract -Recurse -Force }
  Expand-Archive -LiteralPath $zip -DestinationPath $extract
  if (-not (Test-Path -LiteralPath $inner)) { Die "extracted archive missing node-v$version-win-$arch" }
  if (Test-Path -LiteralPath $nodeHome) { Remove-Item -LiteralPath $nodeHome -Recurse -Force }
  Move-Item -LiteralPath $inner -Destination $nodeHome
  Remove-Item -LiteralPath $extract -Recurse -Force
  Remove-Item -LiteralPath $zip -Force
  Write-Step "Node installed to $nodeHome"
  return $nodeHome
}

function Get-NpmCmd([string]$nodeHome, $systemNode) {
  if ($systemNode) {
    $npmCmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if (-not $npmCmd) { Die "npm not found next to Node $($systemNode.Version) - reinstall Node or put npm on PATH" }
    return $npmCmd.Source
  }
  $cmd = Join-Path $nodeHome 'npm.cmd'
  if (-not (Test-Path -LiteralPath $cmd)) { Die "npm.cmd not found in $nodeHome" }
  return $cmd
}

function Invoke-Npm([string]$npmCmd, [string[]]$argsList, $systemNode, [string]$nodeHome) {
  $full = if ($systemNode) { $argsList } else { @('--prefix', $nodeHome) + $argsList }
  & $npmCmd @full
  if ($LASTEXITCODE -ne 0) { Die "npm $($argsList -join ' ') failed with exit code $LASTEXITCODE" }
}

# ---------- git (optional, only for git-hosted plugin installs) ----------

function Ensure-Git {
  if (Get-Command git -ErrorAction SilentlyContinue) { return }
  if ($DshSkipGit) { Warn "git not found (DSH_SKIP_GIT set) - git-hosted plugins will not install"; return }
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if (-not $winget) {
    Warn "git not found and winget is unavailable - install Git from https://git-scm.com/download/win if you need git-hosted plugins"
    return
  }
  Write-Step "git not found; installing via winget (a UAC prompt may appear)"
  try {
    & $winget.Source install -e --id Git.Git --silent --accept-source-agreements --accept-package-agreements
    if ($LASTEXITCODE -ne 0) { Warn "winget git install failed (exit code $LASTEXITCODE)" }
  } catch { Warn "winget git install failed: $($_.Exception.Message)" }
}

# ---------- main ----------

$arch      = Get-DshArch
$psMajor   = $PSVersionTable.PSVersion.Major
$psMinor   = $PSVersionTable.PSVersion.Minor
$isAdmin   = (Test-IsAdmin)

Write-Step "Detected: Windows $([Environment]::OSVersion.Version), PowerShell $psMajor.$psMinor, $arch, $(if ($isAdmin) { 'elevated' } else { 'not elevated' })"
if ($psMajor -lt 5 -or ($psMajor -eq 5 -and $psMinor -lt 1)) { Die "PowerShell 5.1+ required (you have $psMajor.$psMinor)" }
if ([Environment]::OSVersion.Version -lt (New-Object -TypeName System.Version -ArgumentList 10,0,17763)) {
  Warn "Windows 10 1809+ / Server 2019+ recommended (dsh/pty uses ConPTY); older systems may fail at runtime"
}
Test-DiskSpace $DshBase 1024

# 1. Node.js
$systemNode = Get-NodeOnPath
$nodeMode   = ''
$nodeHome   = ''
if ($systemNode -and (Test-NodeCompatible $systemNode.Version)) {
  $nodeMode = 'system'
  $nodeHome = $systemNode.Dir
  Write-Step "Using existing Node $($systemNode.Version) at $nodeHome"
} elseif ($systemNode) {
  Write-Step "Existing Node $($systemNode.Version) is too old (dsh needs Node ^$NodeMinMajor.$NodeMinMinor.0 or >= 24.0.0)"
  $version = Get-NodeDownloadVersion
  $nodeMode = 'portable'
  $nodeHome = Install-PortableNode $version $arch
  Add-ToUserPath $nodeHome
} else {
  Write-Step "Node.js not found"
  $version = Get-NodeDownloadVersion
  $nodeMode = 'portable'
  $nodeHome = Install-PortableNode $version $arch
  Add-ToUserPath $nodeHome
}

# 2. pnpm (required by `dsh plugin` for profile plugin management)
$npmCmd = Get-NpmCmd $nodeHome $systemNode
Write-Step "Ensuring pnpm"
Invoke-Npm $npmCmd @('install','-g','pnpm') $systemNode $nodeHome

# 3. dsh itself
Write-Step "Installing @deepseek-ai/dsh (this pulls the Web UI + agent plugins; keep the terminal open)"
Invoke-Npm $npmCmd @('install','-g','@deepseek-ai/dsh') $systemNode $nodeHome

# 4. npm global prefix reachability, then PATH
if ($nodeMode -eq 'portable') {
  $npmPrefix = $nodeHome
} else {
  $npmPrefix = (& $npmCmd config get prefix 2>$null).Trim()
  if (-not $npmPrefix) { Warn "could not read npm global prefix; dsh may not be on PATH" }
}
if ($npmPrefix) { Add-ToUserPath $npmPrefix }
Add-ToUserPath $nodeHome

# 5. git (best effort)
Ensure-Git

# 6. verify
$dshCmds = @()
if ($npmPrefix) { $dshCmds += (Join-Path $npmPrefix 'dsh.cmd') }
if ($nodeHome)  { $dshCmds += (Join-Path $nodeHome 'node_modules\.bin\dsh.cmd') }
$found = $null
foreach ($c in $dshCmds) { if (Test-Path -LiteralPath $c) { $found = $c; break } }
if (-not $found -and (Get-Command dsh -ErrorAction SilentlyContinue)) { $found = (Get-Command dsh).Source }
if (-not $found) {
  Warn "dsh was installed but the command shim was not found; run manually: $npmCmd install -g @deepseek-ai/dsh"
} else {
  if ($nodeMode -eq 'portable') { $env:Path = "$nodeHome;$env:Path" }
  $dshVersion = (& $found --version 2>$null)
  if ($LASTEXITCODE -ne 0) { Warn "dsh present at $found but --version failed; check this Node install" }
  else { Write-Step "Verified: dsh $dshVersion ($found)" }
}

Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host "Open a NEW terminal, then run:" -ForegroundColor Green
Write-Host "  dsh web" -ForegroundColor Green
Write-Host "The Web UI starts at http://127.0.0.1:3080 - add your DeepSeek API key under Settings -> Models," -ForegroundColor Green
Write-Host "then pick a workspace. Plugin management: dsh plugin --profile <name> add <package>" -ForegroundColor Green
