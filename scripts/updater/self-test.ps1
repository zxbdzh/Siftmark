$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$testRoot=Join-Path ([IO.Path]::GetTempPath()) ('siftmark-updater-test-'+[guid]::NewGuid())
New-Item -ItemType Directory -Path $testRoot | Out-Null
$utf8=New-Object Text.UTF8Encoding($false)
function Assert($condition,[string]$message) { if (-not $condition) {throw $message} }
function Write-Json([string]$path,$value) {[IO.File]::WriteAllText($path,($value|ConvertTo-Json -Depth 12 -Compress),$utf8)}
function Scenario([string]$name,[string]$mode) {
  $case=Join-Path $testRoot $name; New-Item -ItemType Directory -Path $case | Out-Null
  $target=Join-Path $case 'extension';$content=Join-Path $case 'contents';New-Item -ItemType Directory -Path $target,$content | Out-Null
  Write-Json (Join-Path $target 'manifest.json') @{name='Siftmark';manifest_version=3;version='0.1.0'}
  [IO.File]::WriteAllText((Join-Path $target 'background.js'),'old',$utf8)
  Write-Json (Join-Path $content 'manifest.json') @{name='Siftmark';manifest_version=3;version='0.2.0'}
  [IO.File]::WriteAllText((Join-Path $content 'background.js'),'new',$utf8)
  $zip=Join-Path $case 'fixture.zip';[IO.Compression.ZipFile]::CreateFromDirectory($content,$zip)
  if ($mode -eq 'traversal') {
    $archive=[IO.Compression.ZipFile]::Open($zip,[IO.Compression.ZipArchiveMode]::Update)
    try {$stream=($archive.CreateEntry('../escaped.txt')).Open();try {$stream.WriteByte(42)} finally {$stream.Dispose()}} finally {$archive.Dispose()}
  }
  $sha=[Security.Cryptography.SHA256]::Create();$stream=[IO.File]::OpenRead($zip)
  try {$hash=[BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','')} finally {$stream.Dispose();$sha.Dispose()}
  if ($mode -eq 'bad-hash') {$hash='0'*64}
  [IO.File]::WriteAllText((Join-Path $case 'fixture.sha256'),"$hash  siftmark-0.2.0-chromium.zip",$utf8)
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'updater.ps1') -Destination $case
  Write-Json (Join-Path $case 'config.json') @{target=$target;extensionId=('a'*32)}
  $wrapper=@'
param([string]$Action)
function Invoke-RestMethod {param($Uri,$Headers,$TimeoutSec) return @{tag_name='v0.2.0';draft=$false;prerelease=$false;assets=@(@{name='siftmark-0.2.0-chromium.zip';size=100;browser_download_url='https://github.com/zxbdzh/Siftmark/releases/download/v0.2.0/siftmark-0.2.0-chromium.zip'},@{name='siftmark-0.2.0-chromium.zip.sha256';size=100;browser_download_url='https://github.com/zxbdzh/Siftmark/releases/download/v0.2.0/siftmark-0.2.0-chromium.zip.sha256'})}}
function Invoke-WebRequest {param([switch]$UseBasicParsing,$Uri,$OutFile,$TimeoutSec) $source=if($Uri.EndsWith('.sha256')){'fixture.sha256'}else{'fixture.zip'};Copy-Item -LiteralPath (Join-Path $PSScriptRoot $source) -Destination $OutFile}
& (Join-Path $PSScriptRoot 'updater.ps1') -Action $Action
'@
  $wrapperPath=Join-Path $case 'run.ps1';[IO.File]::WriteAllText($wrapperPath,$wrapper,$utf8)
  $raw=& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $wrapperPath -Action apply
  $result=($raw -join [Environment]::NewLine)|ConvertFrom-Json
  if($mode -eq 'valid') {
    Assert $result.ok 'valid update failed'
    Assert ((Get-Content -LiteralPath (Join-Path $target 'background.js') -Raw) -eq 'new') 'new files not installed'
    Assert ((Get-Content -LiteralPath (Join-Path "$target.siftmark-previous" 'background.js') -Raw) -eq 'old') 'old files not preserved'
    $rollback=& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $wrapperPath -Action rollback
    Assert (($rollback|ConvertFrom-Json).ok) 'rollback failed'
    Assert ((Get-Content -LiteralPath (Join-Path $target 'background.js') -Raw) -eq 'old') 'rollback did not restore old files'
  } else {
    Assert (-not $result.ok) 'unsafe archive unexpectedly accepted'
    Assert ((Get-Content -LiteralPath (Join-Path $target 'background.js') -Raw) -eq 'old') 'failure changed installed files'
    Assert (-not (Test-Path -LiteralPath (Join-Path $case 'escaped.txt'))) 'archive escaped extraction root'
  }
  Write-Output "PASS: $name"
}
try {
  # 实际编译宿主，避免只测试 TypeScript 而交付无法启动的 Windows 程序。
  Add-Type -TypeDefinition ([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'NativeHost.cs'))) -ReferencedAssemblies 'System.Web.Extensions' -OutputAssembly (Join-Path $testRoot 'host.exe') -OutputType ConsoleApplication
  # 从真实二进制消息帧检查错误回传，不能只确认 PowerShell 自身输出了原因。
  Write-Json (Join-Path $testRoot 'config.json') @{extensionId=('a'*32)}
  [IO.File]::WriteAllText((Join-Path $testRoot 'updater.ps1'), 'Write-Output ''{"ok":false,"error":"expected-native-error"}''; exit 1', $utf8)
  $process=New-Object Diagnostics.Process
  $process.StartInfo.FileName=Join-Path $testRoot 'host.exe'
  $process.StartInfo.Arguments='chrome-extension://' + ('a'*32) + '/'
  $process.StartInfo.UseShellExecute=$false;$process.StartInfo.CreateNoWindow=$true
  $process.StartInfo.RedirectStandardInput=$true;$process.StartInfo.RedirectStandardOutput=$true
  try {
    $process.Start() | Out-Null
    $message=[Text.Encoding]::UTF8.GetBytes('{"action":"apply"}')
    $inputStream=$process.StandardInput.BaseStream
    $inputStream.Write([BitConverter]::GetBytes([uint32]$message.Length),0,4);$inputStream.Write($message,0,$message.Length);$inputStream.Flush();$process.StandardInput.Close()
    $reader=New-Object IO.BinaryReader($process.StandardOutput.BaseStream)
    $response=[Text.Encoding]::UTF8.GetString($reader.ReadBytes($reader.ReadUInt32())) | ConvertFrom-Json
    Assert ($response.ok -eq $false -and $response.error -eq 'expected-native-error') 'native host discarded updater error'
    Assert ($process.WaitForExit(10000)) 'native host did not exit'
  } finally {$process.Dispose()}
  Write-Output 'PASS: native-host-preserves-error-response'
  Scenario 'verified-install-and-rollback' 'valid'
  Scenario 'hash-mismatch-preserves-installed-files' 'bad-hash'
  Scenario 'path-traversal-rejected' 'traversal'
  Write-Output 'All Windows updater self-checks passed.'
} finally {Remove-Item -LiteralPath $testRoot -Recurse -Force}
