[CmdletBinding(PositionalBinding = $false)]
param(
    [string]$TorchDir = "",
    [int]$Steps = 200,
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ExtraArgs
)

$ErrorActionPreference = "Stop"

if (-not $TorchDir) {
    $TorchDir = if ($env:MEMORIA_TORCH_DIR) { $env:MEMORIA_TORCH_DIR } else { "D:\venv\Lib\site-packages\torch" }
}

$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root "build\memoria_train.exe"
if (-not (Test-Path -LiteralPath $exe)) {
    throw "Build first: scripts\build.ps1"
}
$env:PATH = "$TorchDir\lib;$env:PATH"
& $exe --steps $Steps @ExtraArgs
