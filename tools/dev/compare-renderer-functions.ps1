param(
  [string]$BaseRef = "main",
  [string]$RendererPath = "renderer.js",
  [string]$OutputPath = ""
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $RendererPath)) {
  throw "No existe el archivo '$RendererPath' en el workspace actual."
}

$baseContent = git show "$BaseRef`:$RendererPath" 2>$null
if (-not $baseContent) {
  throw "No se pudo leer '$RendererPath' desde la referencia '$BaseRef'."
}

$currentContent = Get-Content $RendererPath

$pattern = '^\s*(async\s+)?function\s+([A-Za-z0-9_]+)\s*\('

$baseFns = @(
  $baseContent |
    Select-String -Pattern $pattern |
    ForEach-Object { $_.Matches[0].Groups[2].Value }
) | Sort-Object -Unique

$currentFns = @(
  $currentContent |
    Select-String -Pattern $pattern |
    ForEach-Object { $_.Matches[0].Groups[2].Value }
) | Sort-Object -Unique

$missingInCurrent = @($baseFns | Where-Object { $_ -notin $currentFns })
$extraInCurrent = @($currentFns | Where-Object { $_ -notin $baseFns })

$summary = @()
$summary += "renderer compare: $RendererPath"
$summary += "base ref: $BaseRef"
$summary += "base functions: $($baseFns.Count)"
$summary += "current functions: $($currentFns.Count)"
$summary += "missing in current: $($missingInCurrent.Count)"
$summary += "extra in current: $($extraInCurrent.Count)"
$summary += ""
$summary += "=== Missing In Current ==="
if ($missingInCurrent.Count -eq 0) {
  $summary += "(none)"
} else {
  $summary += $missingInCurrent
}
$summary += ""
$summary += "=== Extra In Current ==="
if ($extraInCurrent.Count -eq 0) {
  $summary += "(none)"
} else {
  $summary += $extraInCurrent
}

$report = $summary -join [Environment]::NewLine

if ($OutputPath) {
  $dir = Split-Path -Parent $OutputPath
  if ($dir -and -not (Test-Path $dir)) {
    New-Item -ItemType Directory -Path $dir | Out-Null
  }
  Set-Content -Path $OutputPath -Value $report -Encoding UTF8
  Write-Output "Reporte guardado en: $OutputPath"
}

Write-Output $report
