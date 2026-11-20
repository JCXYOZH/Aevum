# Build the world-only QML shell with PyInstaller.
# The web payload is produced by collect_world.ps1: world.html plus only the
# engine scripts and the default VRM/action assets it loads.
param(
  [string]$Bundle = "$PSScriptRoot\dist\bundle",
  [string]$Name = "AevumWorld"
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

& (Join-Path $PSScriptRoot "collect_world.ps1") -Out $Bundle

$python = if ($env:AEVUM_PYTHON) { $env:AEVUM_PYTHON } else { "D:\venv\Scripts\python.exe" }
$data = @(
  "--add-data", "$PSScriptRoot\Main.qml;.",
  "--add-data", "$PSScriptRoot\VERSION;.",
  "--add-data", "$Bundle\web;web",
  "--add-data", "$Bundle\engine;engine"
)

& $python -m PyInstaller --noconfirm --clean --windowed --name $Name `
  @data --hidden-import PySide6.QtWebEngineQuick qml_world.py

Write-Host "build: $PSScriptRoot\dist\$Name"
