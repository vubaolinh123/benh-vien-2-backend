# Cập nhật backend trên VPS Windows (chạy PowerShell "Run as Administrator").
# Máy chủ dùng chung: chỉ dừng node.exe có đường dẫn nằm trong thư mục backend.
# Tự dừng task benh-vien-api và node trước khi npm ci để tránh lỗi EPERM (sharp .dll bị khóa).
#Requires -RunAsAdministrator
param([string]$AppDir = 'C:\Users\Administrator\Desktop\benh-vien-2-backend')
$ErrorActionPreference = 'Stop'
function Step($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }
function Invoke-Native($exe, [string[]]$arguments) {
  & $exe @arguments
  if ($LASTEXITCODE -ne 0) { throw "$exe $($arguments -join ' ') thất bại (mã $LASTEXITCODE)" }
}
Set-Location $AppDir

Step 'Dừng API'
Stop-ScheduledTask -TaskName 'benh-vien-api' -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like "*$AppDir*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2

Step 'Lấy code mới'
Invoke-Native git @('pull', '--ff-only')

Step 'Cài thư viện và build'
$env:MONGOMS_DISABLE_POSTINSTALL = '1'
Invoke-Native npm.cmd @('ci', '--no-audit', '--no-fund')
Invoke-Native npm.cmd @('run', 'build')

Step 'Khởi động lại API'
Start-ScheduledTask -TaskName 'benh-vien-api'
Start-Sleep -Seconds 5
try { Invoke-RestMethod http://127.0.0.1:4000/api/health | Out-Host }
catch { throw "API chưa chạy. Xem log: $AppDir\logs\api.log" }
Write-Host "`nXONG." -ForegroundColor Green
