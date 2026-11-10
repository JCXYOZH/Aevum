#Requires -Version 5.1
# Build a Windows installer without electron-builder's 7z memory spike.
#
# It uses the Electron runtime already downloaded under
# apps\desktop\node_modules\electron\dist, assembles the same resource layout
# electron-builder would produce, then compiles apps\desktop\installer.iss with
# Inno Setup 7 (the same installer family MrHua used).
#
# Usage, from the repository root:
#   scripts\build-installer.ps1
#   scripts\build-installer.ps1 -SkipMonitorCheck

[CmdletBinding()]
param(
    [switch]$SkipMonitorCheck
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$app = Join-Path $root "apps\desktop"
$distApp = Join-Path $app "dist-app"
$stageName = "installer-app-" + (Get-Date -Format "yyyyMMddHHmmss")
$stage = Join-Path $distApp $stageName
$stageRel = "dist-app\$stageName"
$electronDist = Join-Path $app "node_modules\electron\dist"
$packageJson = Join-Path $app "package.json"
$icon = Join-Path $app "icon.ico"
$iss = Join-Path $app "installer.iss"

foreach ($path in @($electronDist, $packageJson, $icon, $iss)) {
    if (-not (Test-Path -LiteralPath $path)) {
        throw "missing $path; run 'npm install' in apps\desktop first."
    }
}

$pkg = Get-Content -LiteralPath $packageJson -Raw -Encoding UTF8 | ConvertFrom-Json
$productName = $pkg.build.productName
$version = $pkg.version
$exeName = "$productName.exe"
$outFile = Join-Path $distApp "Memoria-Control-Desk-Setup-$version.exe"

$monitorExe = Join-Path $root "apps\console\monitor\dist\memoria-monitor.exe"
if (-not $SkipMonitorCheck -and -not (Test-Path -LiteralPath $monitorExe)) {
    throw "missing $monitorExe; run scripts\package-desktop.ps1 -SkipElectron first."
}

$iscc = (Get-Command iscc -ErrorAction SilentlyContinue).Source
if (-not $iscc) {
    $candidates = @(
        "D:\cybersecurity\Inno Setup 7\ISCC.exe",
        "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
        "C:\Program Files\Inno Setup 6\ISCC.exe"
    )
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) { $iscc = $candidate; break }
    }
}
if (-not $iscc) {
    throw "ISCC.exe not found; install Inno Setup 7 or pass it via PATH."
}

# Assemble the app directory. This mirrors electron-builder's layout without
# using its Go unpacker or 7z compressor.
if (Test-Path -LiteralPath $stage) {
    Remove-Item -LiteralPath $stage -Recurse -Force
}
New-Item -ItemType Directory -Path $stage | Out-Null
robocopy $electronDist $stage /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "copy electron failed (robocopy $LASTEXITCODE)" }
Rename-Item -LiteralPath (Join-Path $stage "electron.exe") -NewName $exeName

$resources = Join-Path $stage "resources"
New-Item -ItemType Directory -Force -Path @(
    (Join-Path $resources "app"),
    (Join-Path $resources "web"),
    (Join-Path $resources "monitor"),
    (Join-Path $resources "contracts"),
    (Join-Path $resources "data")
) | Out-Null
Copy-Item -LiteralPath (Join-Path $app "main.js"), $packageJson, $icon -Destination (Join-Path $resources "app") -Force
robocopy (Join-Path $root "apps\community\web") (Join-Path $resources "web") /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "copy web failed (robocopy $LASTEXITCODE)" }
if (Test-Path -LiteralPath $monitorExe) {
    Copy-Item -LiteralPath $monitorExe -Destination (Join-Path $resources "monitor") -Force
}
Copy-Item -LiteralPath (Join-Path $root "apps\relay\contracts\errors.json") -Destination (Join-Path $resources "contracts") -Force
Copy-Item -LiteralPath (Join-Path $root "data\tinyshakespeare_3000.txt") -Destination (Join-Path $resources "data") -Force
Remove-Item -LiteralPath (Join-Path $resources "default_app.asar") -Force -ErrorAction SilentlyContinue

Push-Location $app
try {
    Write-Host "assembling: $stage"
    Write-Host "compiling:  $outFile"
    & $iscc "/DAppStage=$stageRel" $iss
    if ($LASTEXITCODE -ne 0) { throw "ISCC failed: $LASTEXITCODE" }
} finally {
    Pop-Location
}
if (-not (Test-Path -LiteralPath $outFile)) { throw "installer was not produced: $outFile" }
Write-Host "installer: $outFile ($((Get-Item -LiteralPath $outFile).Length) bytes)"
