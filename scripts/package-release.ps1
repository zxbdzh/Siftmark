param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^\d+\.\d+\.\d+$')]
  [string]$Version
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$distRoot = Join-Path $repoRoot 'dist'
$stagingRoot = Join-Path $distRoot "siftmark-$Version-chromium"
$target = Join-Path $distRoot "siftmark-$Version-chromium.zip"
$startedAt = Get-Date

Push-Location $repoRoot
try {
  pnpm typecheck
  if ($LASTEXITCODE -ne 0) { throw 'typecheck failed' }
  pnpm lint
  if ($LASTEXITCODE -ne 0) { throw 'lint failed' }
  pnpm test --coverage
  if ($LASTEXITCODE -ne 0) { throw 'unit tests failed' }
  pnpm build
  if ($LASTEXITCODE -ne 0) { throw 'build failed' }
  pnpm test:e2e
  if ($LASTEXITCODE -ne 0) { throw 'e2e tests failed' }
  pnpm zip
  if ($LASTEXITCODE -ne 0) { throw 'zip failed' }

  New-Item -ItemType Directory -Force -Path $distRoot | Out-Null
  $resolvedDistRoot = (Resolve-Path -LiteralPath $distRoot).Path
  $resolvedStagingRoot = [System.IO.Path]::GetFullPath($stagingRoot)
  if ([System.IO.Path]::GetDirectoryName($resolvedStagingRoot) -ne $resolvedDistRoot) {
    throw 'release staging directory must be an immediate child of dist'
  }
  if (Test-Path -LiteralPath $resolvedStagingRoot) {
    Remove-Item -LiteralPath $resolvedStagingRoot -Recurse -Force
  }

  $source = Get-ChildItem -LiteralPath (Join-Path $repoRoot '.output') -Recurse -Filter '*.zip' -File |
    Where-Object { $_.LastWriteTime -ge $startedAt } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if (-not $source) { throw 'WXT did not produce a new zip' }

  Copy-Item -LiteralPath $source.FullName -Destination $target -Force
  $hash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
  Set-Content -LiteralPath "$target.sha256" -Value "$hash  $(Split-Path $target -Leaf)" -Encoding ascii
} finally {
  Pop-Location
}
