Param(
  [string]$OutPath = "${PSScriptRoot}\..\colab_bundle.zip"
)

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $repoRoot

# Files/folders to include
$include = @(
  'backend',
  'frontend\src\data',
  '.gitignore',
  'README.md'
)

# Exclude patterns (relative paths)
$excludeRegex = @(
  '^backend\\__pycache__\\',
  '^backend\\\.env$',
  '^backend\\.*\.log$',
  '^frontend\\node_modules\\',
  '^frontend\\build\\',
  '^frontend\\\.cache\\',
  '^\.venv\\',
  '^\.venv-gpu\\',
  '^\.git\\'
)

$tempDir = Join-Path $env:TEMP ("pill-safe-ai_colab_bundle_" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tempDir | Out-Null

try {
  foreach ($item in $include) {
    $src = Join-Path $repoRoot $item
    if (Test-Path $src) {
      $dst = Join-Path $tempDir $item
      New-Item -ItemType Directory -Path (Split-Path $dst) -Force | Out-Null
      Copy-Item -Path $src -Destination $dst -Recurse -Force
    }
  }

  # Remove excluded paths from temp
  $all = Get-ChildItem -Path $tempDir -Recurse -Force | ForEach-Object {
    $rel = $_.FullName.Substring($tempDir.Length).TrimStart('\')
    [PSCustomObject]@{ Full = $_.FullName; Rel = $rel; IsDir = $_.PSIsContainer }
  }

  foreach ($e in $excludeRegex) {
    foreach ($x in $all) {
      if ($x.Rel -match $e) {
        if (Test-Path $x.Full) {
          Remove-Item -LiteralPath $x.Full -Recurse -Force -ErrorAction SilentlyContinue
        }
      }
    }
  }

  if (Test-Path $OutPath) { Remove-Item -LiteralPath $OutPath -Force }
  Compress-Archive -Path (Join-Path $tempDir '*') -DestinationPath $OutPath
  Write-Host "Created: $OutPath"
}
finally {
  if (Test-Path $tempDir) { Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue }
}
