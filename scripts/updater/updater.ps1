param([ValidateSet('check','apply','ack','rollback','status')][string]$Action = 'status')
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root = $PSScriptRoot
$config = Get-Content -LiteralPath (Join-Path $root 'config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$target = [IO.Path]::GetFullPath($config.target)
$stage = "$target.siftmark-stage"
$backup = "$target.siftmark-previous"
$journal = Join-Path $root 'state.json'
$mutex = New-Object Threading.Mutex($false, 'Local\SiftmarkUpdater')
if (-not $mutex.WaitOne(0)) { throw 'Another updater is already running' }
function Get-Sha256([string]$path) {
  $sha=[Security.Cryptography.SHA256]::Create();$stream=[IO.File]::OpenRead($path)
  try {return [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','').ToLowerInvariant()} finally {$stream.Dispose();$sha.Dispose()}
}
function Read-Json([string]$path) { if (Test-Path -LiteralPath $path) { return Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json } return $null }
function Save-State($value) {
  $temp = "$journal.tmp"
  [IO.File]::WriteAllText($temp, ($value | ConvertTo-Json -Depth 12 -Compress), (New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $temp -Destination $journal -Force
}
function Assert-Target {
  if (-not [IO.Path]::IsPathRooted($target) -or $target.Length -lt 12 -or $target.StartsWith($env:WINDIR,[StringComparison]::OrdinalIgnoreCase)) { throw 'Extension install directory is invalid' }
  if (Test-Path -LiteralPath $target) {
    $item = Get-Item -LiteralPath $target
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Extension directory cannot be a link or junction' }
    $manifest = Read-Json (Join-Path $target 'manifest.json')
    if (-not $manifest -or $manifest.manifest_version -ne 3 -or $manifest.name -notin @('__MSG_extensionName__','Siftmark')) { throw 'Bound directory is not a Siftmark extension' }
    return $manifest
  }
  return $null
}
function Get-Release {
  $release = Invoke-RestMethod -Uri 'https://api.github.com/repos/zxbdzh/Siftmark/releases/latest' -Headers @{'User-Agent'='Siftmark-Updater';'Accept'='application/vnd.github+json'} -TimeoutSec 25
  if ($release.draft -or $release.prerelease -or $release.tag_name -notmatch '^v?([0-9]+\.[0-9]+\.[0-9]+)$') { throw 'Release version is not a valid stable version' }
  $version = $Matches[1]
  $name = "siftmark-$version-chromium.zip"
  $asset = @($release.assets | Where-Object name -eq $name)
  $hash = @($release.assets | Where-Object name -eq "$name.sha256")
  if ($asset.Count -ne 1 -or $hash.Count -ne 1 -or $asset[0].size -gt 67108864 -or $hash[0].size -gt 4096) { throw 'GitHub release is missing a unique package or SHA-256 file' }
  foreach ($item in @($asset[0],$hash[0])) {
    if ($item.browser_download_url -notmatch '^https://github\.com/zxbdzh/Siftmark/releases/download/v?[0-9]+\.[0-9]+\.[0-9]+/siftmark-[0-9]+\.[0-9]+\.[0-9]+-chromium\.zip(\.sha256)?$') { throw 'Release download URL is not trusted' }
  }
  return @{version=$version;asset=$asset[0];hash=$hash[0];name=$name}
}
function Expand-VerifiedPackage([string]$zip, [string]$destination, [string]$version) {
  if (Test-Path -LiteralPath $destination) { Remove-Item -LiteralPath $destination -Recurse -Force }
  [IO.Directory]::CreateDirectory($destination) | Out-Null
  $archive = [IO.Compression.ZipFile]::OpenRead($zip)
  try {
    if ($archive.Entries.Count -gt 5000) { throw 'Package contains too many files' }
    $total = 0L; $seen = New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach ($entry in $archive.Entries) {
      $total += $entry.Length
      $path = [IO.Path]::GetFullPath((Join-Path $destination $entry.FullName))
      $prefix = $destination.TrimEnd('\') + '\'
      if (-not $path.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase) -or $entry.FullName -match '[:\x00]' -or (($entry.ExternalAttributes -shr 16) -band 0xF000) -eq 0xA000) { throw 'Package contains an invalid path or link' }
      if (-not $seen.Add($path) -or $total -gt 268435456 -or $entry.Length -gt 67108864) { throw 'Package contains duplicate paths or is too large' }
      if ($entry.FullName.EndsWith('/')) { [IO.Directory]::CreateDirectory($path) | Out-Null; continue }
      [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($path)) | Out-Null
      [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$path,$false)
    }
  } finally { $archive.Dispose() }
  $manifest = Read-Json (Join-Path $destination 'manifest.json')
  if (-not $manifest -or $manifest.manifest_version -ne 3 -or $manifest.version -ne $version -or $manifest.name -notin @('__MSG_extensionName__','Siftmark') -or -not (Test-Path -LiteralPath (Join-Path $destination 'background.js'))) { throw 'Package manifest or entrypoint is invalid' }
}
function Restore-Previous {
  if (-not (Test-Path -LiteralPath $backup)) { throw 'No previous version is available for rollback' }
  $failed = "$target.siftmark-failed"
  if (Test-Path -LiteralPath $failed) { Remove-Item -LiteralPath $failed -Recurse -Force }
  if (Test-Path -LiteralPath $target) { Move-Item -LiteralPath $target -Destination $failed }
  try { Move-Item -LiteralPath $backup -Destination $target }
  catch { if (Test-Path -LiteralPath $failed) { Move-Item -LiteralPath $failed -Destination $target }; throw }
  Save-State @{state='rolled-back';version=(Assert-Target).version;message='Previous version restored'}
}
try {
  $state = Read-Json $journal
  # Keep the original path when a directory rename is interrupted.
  if (-not (Test-Path -LiteralPath $target) -and (Test-Path -LiteralPath $backup)) { Move-Item -LiteralPath $backup -Destination $target; Save-State @{state='rolled-back';message='Recovered an interrupted replacement'}; $state = Read-Json $journal }
  $current = Assert-Target
  if ($Action -eq 'rollback') { Restore-Previous; $result = @{ok=$true;state='rolled-back';version=(Assert-Target).version} }
  elseif ($Action -eq 'ack') {
    if ($state.state -ne 'awaiting-reload' -or $state.version -ne $current.version) { throw 'No matching update is awaiting reload' }
    Save-State @{state='current';version=$current.version;message='New version reloaded; previous version kept for rollback'}
    $result = @{ok=$true;state='current';version=$current.version}
  }
  elseif ($state -and $state.state -eq 'awaiting-reload') { $result=@{ok=$true;state='awaiting-reload';version=$state.version;message='Waiting for browser reload confirmation'} }
  elseif ($Action -eq 'status') { $result=@{ok=$true;state='current';version=$current.version;target=$target;rollbackAvailable=(Test-Path -LiteralPath $backup)} }
  else {
    if (-not $current) { throw 'Bound directory no longer exists; no download or replacement performed' }
    $release = Get-Release
    if ([version]$release.version -le [version]$current.version) { $result=@{ok=$true;state='current';version=$current.version;latest=$release.version} }
    elseif ($Action -eq 'check') { $result=@{ok=$true;state='available';version=$current.version;latest=$release.version} }
    else {
      $zip = Join-Path $root 'download.zip'; $hashFile = Join-Path $root 'download.sha256'
      Invoke-WebRequest -UseBasicParsing -Uri $release.hash.browser_download_url -OutFile $hashFile -TimeoutSec 25 | Out-Null
      $hashLine = [IO.File]::ReadAllText($hashFile).Trim()
      if ($hashLine -notmatch '^([a-fA-F0-9]{64})\s+\*?([^\r\n]+)$' -or $Matches[2] -ne $release.name) { throw 'SHA-256 file format or filename is invalid' }
      $expectedHash = $Matches[1].ToLowerInvariant()
      Invoke-WebRequest -UseBasicParsing -Uri $release.asset.browser_download_url -OutFile $zip -TimeoutSec 60 | Out-Null
      if ((Get-Item -LiteralPath $zip).Length -gt 67108864 -or (Get-Sha256 $zip) -ne $expectedHash) { throw 'Package SHA-256 mismatch; previous version unchanged' }
      Expand-VerifiedPackage $zip $stage $release.version
      if (Test-Path -LiteralPath $backup) { Remove-Item -LiteralPath $backup -Recurse -Force }
      Save-State @{state='replacing';version=$release.version;previousVersion=$current.version}
      Move-Item -LiteralPath $target -Destination $backup
      try { Move-Item -LiteralPath $stage -Destination $target; Assert-Target | Out-Null; Save-State @{state='awaiting-reload';version=$release.version;previousVersion=$current.version} }
      catch { if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }; Move-Item -LiteralPath $backup -Destination $target; Save-State @{state='rolled-back';version=$current.version}; throw }
      $result=@{ok=$true;state='awaiting-reload';version=$release.version;previousVersion=$current.version}
    }
  }
  $result | ConvertTo-Json -Compress -Depth 12
} catch { @{ok=$false;error=$_.Exception.Message} | ConvertTo-Json -Compress; exit 1 }
finally { $mutex.ReleaseMutex(); $mutex.Dispose() }