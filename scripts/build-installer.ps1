#Requires -Version 5.1
# Build a Windows installer without electron-builder's 7z memory spike.
#
# It uses the Electron runtime already downloaded under
# apps\desktop\node_modules\electron\dist, assembles the same resource layout
# electron-builder would produce, then calls NSIS directly (store mode).
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
$unpacked = Join-Path $distApp "installer-app"
$electronDist = Join-Path $app "node_modules\electron\dist"
$packageJson = Join-Path $app "package.json"

foreach ($path in @($electronDist, $packageJson)) {
    if (-not (Test-Path -LiteralPath $path)) {
        throw "missing $path; run 'npm install' in apps\desktop first."
    }
}

$pkg = Get-Content -LiteralPath $packageJson -Raw -Encoding UTF8 | ConvertFrom-Json
$productName = $pkg.build.productName
$version = $pkg.version
$exeName = "$productName.exe"
$iconRel = $pkg.build.win.icon
$icon = [IO.Path]::GetFullPath((Join-Path $app $iconRel))
$artifact = $pkg.build.nsis.artifactName.Replace('${version}', $version).Replace('${ext}', 'exe')
$outFile = Join-Path $distApp $artifact

$monitorExe = Join-Path $root "apps\console\monitor\dist\memoria-monitor.exe"
if (-not $SkipMonitorCheck -and -not (Test-Path -LiteralPath $monitorExe)) {
    throw "missing $monitorExe; run scripts\package-desktop.ps1 -SkipElectron first."
}

$makensis = $null
$cmd = Get-Command makensis -ErrorAction SilentlyContinue
if ($cmd) { $makensis = $cmd.Source }
if (-not $makensis) {
    $cache = Join-Path $env:LOCALAPPDATA "electron-builder\Cache\nsis"
    if (Test-Path -LiteralPath $cache) {
        $makensis = Get-ChildItem -LiteralPath $cache -Recurse -File -Filter makensis.exe |
            Where-Object { $_.DirectoryName -like "*\Bin" } |
            Select-Object -First 1 -ExpandProperty FullName
    }
}
if (-not $makensis) {
    throw "makensis.exe not found; install NSIS or let electron-builder download it once."
}
$nsisDir = Split-Path -Parent (Split-Path -Parent $makensis)

# Assemble the app directory. This mirrors electron-builder's layout without
# using its Go unpacker or 7z compressor.
if (Test-Path -LiteralPath $unpacked) {
    Remove-Item -LiteralPath $unpacked -Recurse -Force
}
New-Item -ItemType Directory -Path $unpacked | Out-Null
robocopy $electronDist $unpacked /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "copy electron failed (robocopy $LASTEXITCODE)" }
Rename-Item -LiteralPath (Join-Path $unpacked "electron.exe") -NewName $exeName

$resources = Join-Path $unpacked "resources"
New-Item -ItemType Directory -Force -Path @(
    (Join-Path $resources "app"),
    (Join-Path $resources "web"),
    (Join-Path $resources "monitor"),
    (Join-Path $resources "contracts"),
    (Join-Path $resources "data")
) | Out-Null
Copy-Item -LiteralPath (Join-Path $app "main.js"), $packageJson -Destination (Join-Path $resources "app") -Force
robocopy (Join-Path $root "apps\community\web") (Join-Path $resources "web") /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "copy web failed (robocopy $LASTEXITCODE)" }
if (Test-Path -LiteralPath $monitorExe) {
    Copy-Item -LiteralPath $monitorExe -Destination (Join-Path $resources "monitor") -Force
}
Copy-Item -LiteralPath (Join-Path $root "apps\relay\contracts\errors.json") -Destination (Join-Path $resources "contracts") -Force
Copy-Item -LiteralPath (Join-Path $root "data\tinyshakespeare_3000.txt") -Destination (Join-Path $resources "data") -Force
Remove-Item -LiteralPath (Join-Path $resources "default_app.asar") -Force -ErrorAction SilentlyContinue

$nsiPath = Join-Path $distApp "memoria-installer.nsi"
$nsi = @'
Unicode true
SetCompress off
RequestExecutionLevel user

!include "MUI2.nsh"

!define APP_NAME "{{PRODUCT}}"
!define APP_VERSION "{{VERSION}}"
!define APP_DIR "{{APP_DIR}}"
!define APP_EXE "{{EXE}}"
!define ICON "{{ICON}}"
!define OUT "{{OUT}}"

Name "${APP_NAME}"
OutFile "${OUT}"
InstallDir "$LOCALAPPDATA\Programs\{{PRODUCT}}"
InstallDirRegKey HKCU "Software\{{PRODUCT}}" "InstallDir"
BrandingText "${APP_NAME} ${APP_VERSION}"
Icon "${ICON}"
UninstallIcon "${ICON}"
VIProductVersion "{{VI_VERSION}}"
VIAddVersionKey "ProductName" "${APP_NAME}"
VIAddVersionKey "FileDescription" "${APP_NAME} installer"
VIAddVersionKey "FileVersion" "${APP_VERSION}"
VIAddVersionKey "ProductVersion" "${APP_VERSION}"
VIAddVersionKey "CompanyName" "Aevum"
VIAddVersionKey "LegalCopyright" "MPL-2.0"

!define MUI_ICON "${ICON}"
!define MUI_UNICON "${ICON}"
!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Section "Install"
  SetOutPath "$INSTDIR"
  File /r "${APP_DIR}\*.*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  CreateDirectory "$SMPROGRAMS\{{PRODUCT}}"
  CreateShortcut "$SMPROGRAMS\{{PRODUCT}}\{{PRODUCT}}.lnk" "$INSTDIR\${APP_EXE}"
  CreateShortcut "$SMPROGRAMS\{{PRODUCT}}\Uninstall.lnk" "$INSTDIR\Uninstall.exe"
  CreateShortcut "$DESKTOP\{{PRODUCT}}.lnk" "$INSTDIR\${APP_EXE}"

  WriteRegStr HKCU "Software\{{PRODUCT}}" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\{{PRODUCT}}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\{{PRODUCT}}" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\{{PRODUCT}}" "Publisher" "Aevum"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\{{PRODUCT}}" "DisplayIcon" "$INSTDIR\${APP_EXE}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\{{PRODUCT}}" "UninstallString" "$INSTDIR\Uninstall.exe"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\{{PRODUCT}}" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\{{PRODUCT}}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\{{PRODUCT}}.lnk"
  RMDir /r "$SMPROGRAMS\{{PRODUCT}}"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\{{PRODUCT}}"
  DeleteRegKey HKCU "Software\{{PRODUCT}}"
SectionEnd
'@

$viVersion = (($version -split '\.') + @('0','0','0','0') | Select-Object -First 4) -join '.'
$nsi = $nsi.Replace('{{PRODUCT}}', $productName).
    Replace('{{VERSION}}', $version).
    Replace('{{VI_VERSION}}', $viVersion).
    Replace('{{APP_DIR}}', $unpacked).
    Replace('{{EXE}}', $exeName).
    Replace('{{ICON}}', $icon).
    Replace('{{OUT}}', $outFile)
[IO.File]::WriteAllText($nsiPath, $nsi, (New-Object Text.UTF8Encoding $false))

$env:NSISDIR = $nsisDir
Write-Host "assembling: $unpacked"
Write-Host "compiling:  $outFile"
& $makensis $nsiPath
if ($LASTEXITCODE -ne 0) { throw "makensis failed: $LASTEXITCODE" }
if (-not (Test-Path -LiteralPath $outFile)) { throw "installer was not produced: $outFile" }
Write-Host "installer: $outFile ($((Get-Item -LiteralPath $outFile).Length) bytes)"
