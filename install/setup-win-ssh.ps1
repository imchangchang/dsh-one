<#
.SYNOPSIS
  dsh-one dev access: configure OpenSSH Server on Windows so the dev machine can SSH in.

.DESCRIPTION
  Unofficial tooling maintained by the dsh-one repo (unrelated to dsh itself).
  Automatically: install/enable OpenSSH Server, start on boot, open the firewall for port
  22, install the dev machine public key (both the user and the Administrators group
  authorized_keys locations), then print the connection info (sshd status / LAN IPv4 /
  current username). Requires an elevated PowerShell.

.EXAMPLE
  irm https://raw.githubusercontent.com/imchangchang/dsh-one/main/install/setup-win-ssh.ps1 | iex

.NOTES
  Only toggles local OpenSSH for dev debugging; other sshd_config settings untouched.
  The key belongs to the dev machine; delete it from both locations to revoke.
#>

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

# Public key of the dsh-one dev machine (ed25519, SSH debug access only).
$DevPubKey = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIO6dfqCUtr12URWqpAicLiiHtlzdBqZDacodrpcwLLdJ dsh-one-win-ssh'

function Write-Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Die($msg)        { Write-Host "error: $msg" -ForegroundColor Red; exit 1 }

function Test-IsAdmin {
  try {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $p  = New-Object Security.Principal.WindowsPrincipal($id)
    return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  } catch { return $false }
}

if (-not (Test-IsAdmin)) {
  Die "administrator elevation required: right-click PowerShell and run as administrator"
}

# 1. OpenSSH Server (Add-WindowsCapability returns success when already installed)
Write-Step "Installing OpenSSH Server"
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0

# 2. Keep the sshd service running and auto-start
Write-Step "Ensuring sshd service is running and auto-start"
Start-Service sshd
Set-Service -Name sshd -StartupType Automatic

# 3. Firewall: allow inbound 22 (usually added by the capability install; idempotent)
Write-Step "Ensuring firewall allows inbound port 22"
$rule = Get-NetFirewallRule -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -eq 'OpenSSH Server (sshd)' }
if (-not $rule) {
  New-NetFirewallRule -Name sshd -DisplayName 'OpenSSH Server (sshd)' -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22 | Out-Null
}

# 4. Install the key: user location + Administrators group location (checked first)
Write-Step "Installing the dev key into authorized_keys"
$userKeys = Join-Path $env:USERPROFILE '.ssh\authorized_keys'
New-Item (Split-Path $userKeys -Parent) -ItemType Directory -Force | Out-Null
if (-not (Test-Path $userKeys)) { New-Item $userKeys -ItemType File -Force | Out-Null }
if (-not (Select-String -SimpleMatch $DevPubKey -Path $userKeys -Quiet)) {
  Add-Content -LiteralPath $userKeys -Value $DevPubKey
}
$adminKeys = Join-Path $env:ProgramData 'ssh\administrators_authorized_keys'
if (Test-Path (Split-Path $adminKeys -Parent)) {
  if (-not (Test-Path $adminKeys)) { New-Item $adminKeys -ItemType File -Force | Out-Null }
  if (-not (Select-String -SimpleMatch $DevPubKey -Path $adminKeys -Quiet)) {
    Add-Content -LiteralPath $adminKeys -Value $DevPubKey
  }
  # Administrators-group auth requires this file to be writable only by SYSTEM/Administrators.
  icacls $adminKeys /inheritance:r /grant "SYSTEM:F" /grant "Administrators:F" | Out-Null
}

# 5. Print the connection info (to send back to the dev machine)
Write-Step "Done. Connection info:"
$ip = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notlike '169.254.*' -and $_.IPAddress -ne '127.0.0.1' } |
  Where-Object { $_.IPAddress -like '192.168.*' -or $_.IPAddress -like '10.*' -or $_.IPAddress -like '172.16.*' -or $_.IPAddress -like '172.17.*' -or $_.IPAddress -like '172.18.*' -or $_.IPAddress -like '172.19.*' -or $_.IPAddress -like '172.20.*' -or $_.IPAddress -like '172.21.*' -or $_.IPAddress -like '172.22.*' -or $_.IPAddress -like '172.23.*' -or $_.IPAddress -like '172.24.*' -or $_.IPAddress -like '172.25.*' -or $_.IPAddress -like '172.26.*' -or $_.IPAddress -like '172.27.*' -or $_.IPAddress -like '172.28.*' -or $_.IPAddress -like '172.29.*' -or $_.IPAddress -like '172.30.*' -or $_.IPAddress -like '172.31.*' } |
  Select-Object -First 1 -ExpandProperty IPAddress
if (-not $ip) { $ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike '169.254.*' -and $_.IPAddress -ne '127.0.0.1' } | Select-Object -First 1 -ExpandProperty IPAddress) }
Write-Host "sshd      : $((Get-Service sshd).Status)"
Write-Host "ipv4      : $ip"
Write-Host "username  : $(whoami)"
Write-Host ""
Write-Host "Send these lines back to the dev machine." -ForegroundColor Green
