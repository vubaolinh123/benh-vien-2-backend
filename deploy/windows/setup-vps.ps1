# Cài toàn bộ môi trường chạy backend trên VPS Windows (chạy bằng PowerShell "Run as Administrator").
# Kết quả: MongoDB (chỉ 127.0.0.1:27017) + API Node (127.0.0.1:4000) + Caddy (80/443, HTTPS Let's Encrypt) tự chạy khi khởi động máy.
#
# Ví dụ:
#   powershell -ExecutionPolicy Bypass -File .\setup-vps.ps1 -PublicHost 1-2-3-4.sslip.io -SiteOrigin https://benh-vien.vercel.app -AdminEmail admin@benhvien.vn -AdminPassword 'MatKhauManh@2026' -Seed
#
# Chạy lại script để cập nhật code (git pull + build + khởi động lại); .env đã có sẽ được giữ nguyên.
#Requires -RunAsAdministrator
param(
  # Hostname công khai trỏ về VPS. Chưa có domain thì dùng <IP-dạng-gạch-ngang>.sslip.io, ví dụ 1-2-3-4.sslip.io
  [Parameter(Mandatory = $true)] [string]$PublicHost,
  # Domain frontend trên Vercel, ví dụ https://benh-vien.vercel.app (không có / ở cuối)
  [Parameter(Mandatory = $true)] [string]$SiteOrigin,
  [string]$RepoUrl = 'https://github.com/vubaolinh123/benh-vien-2-backend.git',
  [string]$AppDir = 'C:\apps\benh-vien-api',
  [string]$CaddyDir = 'C:\apps\caddy',
  [string]$AdminEmail = '',
  [string]$AdminPassword = '',
  # Tạo tài khoản admin + dữ liệu mẫu. Bỏ qua nếu sẽ chuyển dữ liệu cũ từ VPS Linux sang.
  [switch]$Seed
)
$ErrorActionPreference = 'Stop'
$SiteOrigin = $SiteOrigin.TrimEnd('/')

function Step($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }
function Refresh-Path { $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') }
function Invoke-Native($exe, [string[]]$arguments) {
  & $exe @arguments
  if ($LASTEXITCODE -ne 0) { throw "$exe $($arguments -join ' ') thất bại (mã $LASTEXITCODE)" }
}
function Register-AutoStart($name, $command, $workDir) {
  $action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$command`"" -WorkingDirectory $workDir
  $trigger = New-ScheduledTaskTrigger -AtStartup
  $settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
  Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
  Start-ScheduledTask -TaskName $name
}

Step 'Kiểm tra cổng 80/443 chưa bị chương trình khác (IIS...) chiếm'
$busy = Get-NetTCPConnection -State Listen -LocalPort 80, 443 -ErrorAction SilentlyContinue |
  Where-Object { (Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).ProcessName -ne 'caddy' }
if ($busy) {
  $busy | ForEach-Object { Write-Host "Cổng $($_.LocalPort) đang dùng bởi PID $($_.OwningProcess) ($((Get-Process -Id $_.OwningProcess).ProcessName))" -ForegroundColor Yellow }
  throw 'Hãy tắt chương trình đang chiếm cổng 80/443 (ví dụ IIS: Stop-Service W3SVC; Set-Service W3SVC -StartupType Disabled) rồi chạy lại.'
}

Step 'Cài Node.js LTS, Git, MongoDB'
Refresh-Path
$haveAll = (Get-Command node -ErrorAction SilentlyContinue) -and (Get-Command git -ErrorAction SilentlyContinue) -and (Get-Service MongoDB -ErrorAction SilentlyContinue)
if ($haveAll) { Write-Host 'Node.js, Git, MongoDB đã có' }
elseif (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
  throw 'Máy chưa có winget. Cài tay Node.js 22+ (nodejs.org), Git (git-scm.com) và MongoDB Community Server (mongodb.com, chọn "Install as Service"), rồi chạy lại script.'
} else {
  foreach ($id in 'OpenJS.NodeJS.LTS', 'Git.Git', 'MongoDB.Server') {
    winget list --id $id -e --accept-source-agreements | Out-Null
    if ($LASTEXITCODE -ne 0) { Invoke-Native winget @('install', '--id', $id, '-e', '--silent', '--accept-source-agreements', '--accept-package-agreements') }
    else { Write-Host "$id đã có" }
  }
}
Refresh-Path
node --version

Step 'Kiểm tra MongoDB đang chạy ở 127.0.0.1:27017'
$mongo = Get-Service -Name MongoDB -ErrorAction SilentlyContinue
if (-not $mongo) { throw 'Không thấy dịch vụ MongoDB. Cài lại MongoDB Community Server với tuỳ chọn "Install as Service".' }
Set-Service MongoDB -StartupType Automatic
if ($mongo.Status -ne 'Running') { Start-Service MongoDB }
if (-not (Test-NetConnection 127.0.0.1 -Port 27017 -InformationLevel Quiet)) { throw 'MongoDB chưa nghe ở 127.0.0.1:27017.' }

Step 'Tải code backend'
if (Test-Path (Join-Path $AppDir '.git')) { Invoke-Native git @('-C', $AppDir, 'pull', '--ff-only') }
else { New-Item -ItemType Directory -Force (Split-Path $AppDir) | Out-Null; Invoke-Native git @('clone', $RepoUrl, $AppDir) }
Set-Location $AppDir

Step 'Dừng API đang chạy (tránh khóa file sharp .dll khi npm ci)'
Stop-ScheduledTask -TaskName 'benh-vien-api' -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like "*$AppDir*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2

Step 'Cài thư viện và build'
$env:MONGOMS_DISABLE_POSTINSTALL = '1'
Invoke-Native npm.cmd @('ci', '--no-audit', '--no-fund')
Invoke-Native npm.cmd @('run', 'build')

Step 'Tạo .env'
$envFile = Join-Path $AppDir '.env'
New-Item -ItemType Directory -Force (Join-Path $AppDir 'uploads'), (Join-Path $AppDir 'logs') | Out-Null
if (Test-Path $envFile) {
  Write-Host '.env đã tồn tại, giữ nguyên.'
} else {
  $bytes = New-Object byte[] 48
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $jwt = -join ($bytes | ForEach-Object { $_.ToString('x2') })
  $content = @"
NODE_ENV=production
PORT=4000
HOST=127.0.0.1
MONGODB_URI=mongodb://127.0.0.1:27017/dai-an
JWT_SECRET=$jwt
SITE_ORIGIN=$SiteOrigin
TRUST_PROXY=2
UPLOAD_DIR=$AppDir\uploads
ADMIN_EMAIL=$AdminEmail
ADMIN_PASSWORD=$AdminPassword
ADMIN_NAME="Quản trị viên"
TURNSTILE_SECRET_KEY=
"@
  [IO.File]::WriteAllText($envFile, $content, (New-Object Text.UTF8Encoding($false)))
  Write-Host "Đã tạo $envFile"
}

if ($Seed) {
  Step 'Tạo tài khoản admin và dữ liệu ban đầu'
  if (-not $AdminEmail -or -not $AdminPassword) { throw 'Cần -AdminEmail và -AdminPassword khi dùng -Seed.' }
  Invoke-Native npm.cmd @('run', 'seed')
}

Step 'Đăng ký API tự chạy khi khởi động (task "benh-vien-api")'
$node = (Get-Command node).Source
Register-AutoStart 'benh-vien-api' "`"$node`" --env-file-if-exists=.env dist/server.js >> logs\api.log 2>&1" $AppDir
$healthy = $false
foreach ($i in 1..15) {
  Start-Sleep -Seconds 2
  try { Invoke-RestMethod http://127.0.0.1:4000/api/health | Out-Host; $healthy = $true; break } catch { Write-Host '...' }
}
if (-not $healthy) { throw "API chưa chạy. Xem log: $AppDir\logs\api.log" }

Step 'Cài Caddy (HTTPS reverse proxy)'
New-Item -ItemType Directory -Force $CaddyDir | Out-Null
$caddyExe = Join-Path $CaddyDir 'caddy.exe'
if (-not (Test-Path $caddyExe)) {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest 'https://caddyserver.com/api/download?os=windows&arch=amd64' -OutFile $caddyExe -UseBasicParsing
}
$caddyfile = @"
$PublicHost {
  encode zstd gzip
  request_body {
    max_size 21MB
  }
  reverse_proxy 127.0.0.1:4000 {
    transport http {
      dial_timeout 5s
      response_header_timeout 30s
    }
  }
  log {
    output file $($CaddyDir -replace '\\', '/')/access.log
  }
}
"@
[IO.File]::WriteAllText((Join-Path $CaddyDir 'Caddyfile'), $caddyfile, (New-Object Text.UTF8Encoding($false)))
Invoke-Native $caddyExe @('validate', '--config', (Join-Path $CaddyDir 'Caddyfile'), '--adapter', 'caddyfile')
Register-AutoStart 'caddy' "`"$caddyExe`" run --config Caddyfile --adapter caddyfile >> caddy.log 2>&1" $CaddyDir

Step "Chờ Caddy lấy chứng chỉ HTTPS cho $PublicHost"
$ok = $false
foreach ($i in 1..12) {
  Start-Sleep -Seconds 10
  try { Invoke-RestMethod "https://$PublicHost/api/health" | Out-Host; $ok = $true; break } catch { Write-Host '...' }
}
if ($ok) {
  Write-Host "`nXONG. Đặt API_INTERNAL_URL=https://$PublicHost trên Vercel rồi Redeploy." -ForegroundColor Green
} else {
  Write-Host "`nAPI chạy nội bộ nhưng chưa truy cập được https://$PublicHost. Kiểm tra NAT/firewall cổng 80 và 443, và log $CaddyDir\caddy.log" -ForegroundColor Yellow
}
