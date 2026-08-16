param(
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
  [string]$Source = 'design\generated\siftmark-logo-relay.png'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$sourcePath = Join-Path $ProjectRoot $Source
if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
  throw "Missing source logo: $sourcePath"
}

$publicIconDirectory = Join-Path $ProjectRoot 'public\icons'
$assetIconDirectory = Join-Path $ProjectRoot 'assets\icons'
New-Item -ItemType Directory -Force -Path $publicIconDirectory | Out-Null

$sourceImage = [System.Drawing.Image]::FromFile($sourcePath)
try {
  if ($sourceImage.Width -ne $sourceImage.Height) {
    throw "Source logo must be square: $($sourceImage.Width)x$($sourceImage.Height)"
  }

  foreach ($size in 16, 32, 48, 128) {
    $bitmap = [System.Drawing.Bitmap]::new(
      $size,
      $size,
      [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
    )
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.Clear([System.Drawing.Color]::Transparent)
      $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
      $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $graphics.DrawImage(
        $sourceImage,
        [System.Drawing.Rectangle]::new(0, 0, $size, $size),
        0,
        0,
        $sourceImage.Width,
        $sourceImage.Height,
        [System.Drawing.GraphicsUnit]::Pixel
      )
      $outputPath = Join-Path $publicIconDirectory "siftmark-$size.png"
      $bitmap.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    finally {
      $graphics.Dispose()
      $bitmap.Dispose()
    }
  }
}
finally {
  $sourceImage.Dispose()
}

Copy-Item -LiteralPath (Join-Path $publicIconDirectory 'siftmark-128.png') -Destination (Join-Path $assetIconDirectory 'siftmark-128.png') -Force
