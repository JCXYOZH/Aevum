#Requires -Version 5.1
# Build a Windows installer without electron-builder's 7z memory spike.
#
# It uses an Electron runtime (`interface/desktop/node_modules/electron/dist` by
# default), assembles the same resource layout electron-builder would produce,
# then compiles interface/desktop/installer.iss with Inno Setup 7.
#
# When the open-source tree has no node_modules, pass an external runtime:
#   ops\scripts\build-installer.ps1 -ElectronDist <path-to-electron-dist>
#
# Usage, from the repository root:
#   ops\scripts\package-desktop.ps1 -SkipElectron
#   ops\scripts\build-installer.ps1

[CmdletBinding()]
param(
    [string]$ElectronDist,
    [string]$MonitorExe,
    [string]$RelayExe,
    [string]$BridgeExe,
    [string]$ModelExe,
    [string]$TorchLib,
    [string]$QemuDir,
    [string]$CheckpointDir,
    [switch]$SkipMonitorCheck,
    [switch]$SkipModel,
    [switch]$SkipQemu
)

$ErrorActionPreference = "Stop"

$Robocopy = Join-Path $env:SystemRoot "System32\robocopy.exe"

function Copy-Tree([string]$source, [string]$destination) {
    if (-not (Test-Path -LiteralPath $source)) { throw "missing $source" }
    New-Item -ItemType Directory -Force -Path $destination | Out-Null
    & $Robocopy $source $destination /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "copy failed ($source -> $destination, robocopy $LASTEXITCODE)" }
}

$root = Split-Path -Parent $PSScriptRoot
$app = Join-Path $root "interface\desktop"
$distApp = Join-Path $app "dist-app"
$stageName = "installer-app-" + (Get-Date -Format "yyyyMMddHHmmss")
$stage = Join-Path $distApp $stageName
$stageRel = "dist-app\$stageName"
if (-not $ElectronDist) { $ElectronDist = $env:MEMORIA_ELECTRON_DIST }
if (-not $ElectronDist) { $ElectronDist = Join-Path $app "node_modules\electron\dist" }
if (-not $MonitorExe) { $MonitorExe = $env:MEMORIA_MONITOR_EXE }
if (-not $MonitorExe) { $MonitorExe = Join-Path $root "archive\backend-python\monitor\dist\memoria-monitor.exe" }
if (-not $RelayExe) { $RelayExe = $env:MEMORIA_RELAY_EXE }
if (-not $RelayExe) { $RelayExe = Join-Path $root "command\relay\dist\memoria-relay.exe" }
if (-not $BridgeExe) { $BridgeExe = $env:MEMORIA_BRIDGE_EXE }
if (-not $BridgeExe) { $BridgeExe = Join-Path $root "src\kernel\host\bridge\dist\memoria-bridge.exe" }
if (-not $ModelExe) { $ModelExe = $env:MEMORIA_MODEL_EXE }
if (-not $ModelExe) { $ModelExe = Join-Path $root "build\memoria_gen_cpu.exe" }
if (-not $TorchLib) { $TorchLib = $env:MEMORIA_TORCH_LIB }
if (-not $TorchLib) { $TorchLib = Join-Path "D:\venv\Lib\site-packages\torch" "lib" }
if (-not $QemuDir) { $QemuDir = $env:MEMORIA_QEMU_DIR }
if (-not $QemuDir) { $QemuDir = "C:\Program Files\qemu" }
if (-not $CheckpointDir) { $CheckpointDir = Join-Path $root "build\checkpoint_aevum_shakespeare" }
$packageJson = Join-Path $app "package.json"
$icon = Join-Path $app "icon.ico"
$iss = Join-Path $app "installer.iss"

foreach ($path in @($ElectronDist, $packageJson, $icon, $iss)) {
    if (-not (Test-Path -LiteralPath $path)) {
        throw "missing $path; run 'npm install' in interface\desktop first, or pass -ElectronDist."
    }
}

$pkg = Get-Content -LiteralPath $packageJson -Raw -Encoding UTF8 | ConvertFrom-Json
$productName = $pkg.build.productName
$version = $pkg.version
$exeName = "$productName.exe"
$outFile = Join-Path $distApp "Memoria-Control-Desk-Setup-$version.exe"

if (-not $SkipMonitorCheck) {
    foreach ($path in @($MonitorExe, $RelayExe, $BridgeExe)) {
        if (-not (Test-Path -LiteralPath $path)) {
            throw "missing $path; run ops\scripts\package-desktop.ps1 -SkipElectron first, or pass the *_EXE overrides."
        }
    }
}

if (-not $SkipModel -and -not (Test-Path -LiteralPath $ModelExe)) {
    throw "missing model executable: $ModelExe; build it or pass -SkipModel."
}

$iscc = (Get-Command iscc -ErrorAction SilentlyContinue).Source
if (-not $iscc) {
    $candidates = @(
        "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
        "C:\Program Files\Inno Setup 6\ISCC.exe",
        "C:\Program Files (x86)\Inno Setup 7\ISCC.exe",
        "C:\Program Files\Inno Setup 7\ISCC.exe"
    )
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) { $iscc = $candidate; break }
    }
}
if (-not $iscc) {
    throw "ISCC.exe not found; install Inno Setup 6 or 7, or pass it via PATH."
}

# Assemble the app directory. This mirrors electron-builder's layout without
# using its Go unpacker or 7z compressor.
if (Test-Path -LiteralPath $stage) {
    Remove-Item -LiteralPath $stage -Recurse -Force
}
New-Item -ItemType Directory -Path $stage | Out-Null
& $Robocopy $ElectronDist $stage /MIR /XF default_app.asar /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "copy electron failed (robocopy $LASTEXITCODE)" }
Rename-Item -LiteralPath (Join-Path $stage "electron.exe") -NewName $exeName

$resources = Join-Path $stage "resources"
$buildDest = Join-Path $resources "build"
$runtimeDest = Join-Path $buildDest "runtime"
New-Item -ItemType Directory -Force -Path @(
    (Join-Path $resources "app"),
    (Join-Path $resources "web"),
    (Join-Path $resources "monitor"),
    (Join-Path $resources "relay"),
    (Join-Path $resources "bridge"),
    (Join-Path $resources "contracts"),
    (Join-Path $resources "data"),
    (Join-Path $resources "kernel"),
    $buildDest,
    $runtimeDest
) | Out-Null
Copy-Item -LiteralPath (Join-Path $app "main.js"), $packageJson, $icon -Destination (Join-Path $resources "app") -Force
Copy-Tree (Join-Path $root "interface\web") (Join-Path $resources "web")
Copy-Item -LiteralPath $MonitorExe -Destination (Join-Path $resources "monitor\memoria-monitor.exe") -Force
Copy-Item -LiteralPath $RelayExe -Destination (Join-Path $resources "relay\memoria-relay.exe") -Force
Copy-Item -LiteralPath $BridgeExe -Destination (Join-Path $resources "bridge\memoria-bridge.exe") -Force
Copy-Item -LiteralPath (Join-Path $root "command\relay\contracts\errors.json") -Destination (Join-Path $resources "contracts") -Force
Copy-Item -LiteralPath (Join-Path $root "data\tinyshakespeare_3000.txt") -Destination (Join-Path $resources "data") -Force

# The kernel disk image is part of the product, not an external checkout.
Copy-Item -LiteralPath (Join-Path $root "src\kernel\host\console\disk.img") -Destination (Join-Path $resources "kernel") -Force
foreach ($name in @("boot.bin", "stage2.bin", "contract-rules.txt")) {
    $source = Join-Path $root "src\kernel\host\console\$name"
    if (Test-Path -LiteralPath $source) {
        Copy-Item -LiteralPath $source -Destination (Join-Path $resources "kernel") -Force
    }
}

if (-not $SkipModel) {
    Copy-Item -LiteralPath $ModelExe -Destination (Join-Path $buildDest "memoria_gen_cpu.exe") -Force
    $trainExe = Join-Path $root "build\memoria_train.exe"
    if (Test-Path -LiteralPath $trainExe) {
        Copy-Item -LiteralPath $trainExe -Destination (Join-Path $buildDest "memoria_train.exe") -Force
    }
    if (Test-Path -LiteralPath $CheckpointDir) {
        Copy-Tree $CheckpointDir (Join-Path $buildDest "checkpoint_aevum_shakespeare")
    }
    $metrics = Join-Path $root "build\training_metrics.jsonl"
    if (Test-Path -LiteralPath $metrics) {
        Copy-Item -LiteralPath $metrics -Destination (Join-Path $buildDest "training_metrics.jsonl") -Force
    }

    if (-not (Test-Path -LiteralPath $TorchLib)) {
        throw "missing torch runtime directory: $TorchLib; pass -TorchLib or -SkipModel."
    }
    # CPU-only torch runtime. CUDA/cuDNN/cuBLAS DLLs are deliberately excluded:
    # memoria_gen_cpu.exe never loads them and they add nearly 4 GB.
    Get-ChildItem -LiteralPath $TorchLib -Filter "*.dll" |
        Where-Object {
            $_.Name -notmatch "cublas|cudnn|cusparse|cufft|cusolver|nvrtc|nvJitLink|curand|c10_cuda|torch_cuda"
        } |
        ForEach-Object {
            Copy-Item -LiteralPath $_.FullName -Destination $runtimeDest -Force
        }
}

if (-not $SkipQemu) {
    if (-not (Test-Path -LiteralPath $QemuDir)) {
        throw "missing QEMU directory: $QemuDir; pass -QemuDir or -SkipQemu."
    }
    $qemuDest = Join-Path $resources "qemu"
    New-Item -ItemType Directory -Force -Path (Join-Path $qemuDest "share\keymaps") | Out-Null
    Copy-Item -LiteralPath (Join-Path $QemuDir "qemu-system-i386.exe") -Destination $qemuDest -Force
    Get-ChildItem -LiteralPath $QemuDir -Filter "*.dll" |
        Copy-Item -Destination $qemuDest -Force
    foreach ($name in @("COPYING", "COPYING.LIB")) {
        $license = Join-Path $QemuDir $name
        if (Test-Path -LiteralPath $license) { Copy-Item -LiteralPath $license -Destination $qemuDest -Force }
    }
    # Only the i386 firmware set is needed. The full share/ tree is ~363 MB and
    # contains firmware for every architecture QEMU ships.
    $firmware = @(
        "bios.bin", "bios-256k.bin", "kvmvapic.bin", "linuxboot_dma.bin",
        "multiboot_dma.bin", "qboot.rom", "qemu_vga.ndrv",
        "vgabios.bin", "vgabios-*.bin", "pxe-*.rom", "efi-*.rom",
        "edk2-i386-code.fd", "edk2-i386-vars.fd"
    )
    foreach ($pattern in $firmware) {
        Get-ChildItem -LiteralPath (Join-Path $QemuDir "share") -Filter $pattern -File -ErrorAction SilentlyContinue |
            Copy-Item -Destination (Join-Path $qemuDest "share") -Force
    }
    $keymaps = Join-Path $QemuDir "share\keymaps"
    if (Test-Path -LiteralPath $keymaps) {
        Copy-Tree $keymaps (Join-Path $qemuDest "share\keymaps")
    }
}

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
