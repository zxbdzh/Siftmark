param(
  [Parameter(Mandatory=$true)][string]$ExtensionPath,
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-p]{32}$')][string]$ExtensionId
)
$ErrorActionPreference='Stop'
$target=(Resolve-Path -LiteralPath $ExtensionPath).Path
$manifest=Get-Content -LiteralPath (Join-Path $target 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.manifest_version -ne 3 -or $manifest.name -notin @('__MSG_extensionName__','Siftmark')) { throw '请选择已解压的 Siftmark 安装目录' }
$install=Join-Path $env:LOCALAPPDATA 'Siftmark\Updater'
New-Item -ItemType Directory -Force -Path $install | Out-Null
# 首次安装只注册当前用户的宿主，不要求管理员，不修改浏览器书签与配置。
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'updater.ps1') -Destination $install -Force
$exe=Join-Path $install 'siftmark-updater.exe'
if (Test-Path -LiteralPath $exe) { Remove-Item -LiteralPath $exe -Force }
Add-Type -TypeDefinition ([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'NativeHost.cs'))) -ReferencedAssemblies 'System.Web.Extensions' -OutputAssembly $exe -OutputType ConsoleApplication
$utf8=New-Object Text.UTF8Encoding($false)
[IO.File]::WriteAllText((Join-Path $install 'config.json'),(@{target=$target;extensionId=$ExtensionId}|ConvertTo-Json),$utf8)
$hostManifest=Join-Path $install 'com.siftmark.updater.json'
[IO.File]::WriteAllText($hostManifest,(@{name='com.siftmark.updater';description='Siftmark Windows updater';path=$exe;type='stdio';allowed_origins=@("chrome-extension://$ExtensionId/")}|ConvertTo-Json),$utf8)
foreach ($browser in @('Google\Chrome','Microsoft\Edge','Chromium')) {
  $key="HKCU:\Software\$browser\NativeMessagingHosts\com.siftmark.updater"
  New-Item -Path $key -Force | Out-Null
  Set-Item -Path $key -Value $hostManifest
}
Write-Output "Siftmark updater installed for $target. Enable automatic updates in extension settings."
