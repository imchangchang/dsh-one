<#
.SYNOPSIS
  dsh-one 开发接入：在 Windows 上配置 OpenSSH Server，供开发机（Mac）SSH 直连调试。

.DESCRIPTION
  非官方工具脚本（dsh-one 仓库维护，与 dsh 本体无关）。
  自动完成：安装/启用 OpenSSH Server、开机自启、防火墙放行 22、写入开发机公钥
  （普通用户与 Administrators 组两个认证位置），最后打印连接所需信息
  （sshd 状态 / 内网 IPv4 / 当前用户名）。需要管理员权限的 PowerShell。

.EXAMPLE
  irm https://raw.githubusercontent.com/imchangchang/dsh-one/main/install/setup-win-ssh.ps1 | iex

.NOTES
  只配置本机 OpenSSH 用于开发调试；不修改 sshd_config 其他项。
  公钥是开发机专用密钥，如不再使用可在两个位置删除。
#>

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

# dsh-one 开发机的公钥（ed25519，仅用于 SSH 调试接入）。
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
  Die "需要管理员权限：右键 PowerShell 「以管理员身份运行」后再执行本条命令"
}

# 1. OpenSSH Server（已安装时 Add-WindowsCapability 直接返回成功）
Write-Step "Installing OpenSSH Server"
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0

# 2. 服务开机自启并保持运行
Write-Step "Ensuring sshd service is running and auto-start"
Start-Service sshd
Set-Service -Name sshd -StartupType Automatic

# 3. 防火墙放行 22（能力安装一般已自动加规则，重复创建无害，幂等处理）
Write-Step "Ensuring firewall allows inbound port 22"
$rule = Get-NetFirewallRule -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -eq 'OpenSSH Server (sshd)' }
if (-not $rule) {
  New-NetFirewallRule -Name sshd -DisplayName 'OpenSSH Server (sshd)' -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22 | Out-Null
}

# 4. 写入公钥：普通用户位置 + Administrators 组位置（认证优先读后者）
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
  # Administrators 组认证要求该文件仅 SYSTEM/Administrators 可写，否则 sshd 拒绝读。
  icacls $adminKeys /inheritance:r /grant "SYSTEM:F" /grant "Administrators:F" | Out-Null
}

# 5. 打印连接所需信息（回传给开发机）
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
Write-Host "把这四行回传给开发机即可。" -ForegroundColor Green
