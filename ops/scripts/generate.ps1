# One-command generation wrapper. It mirrors ops/scripts/train.ps1: all paths come
# from arguments or environment variables, and the torch lib directory is
# prepended only for this process.
[CmdletBinding(PositionalBinding = $false)]
param(
    [Parameter(Mandatory = $true)][string]$Checkpoint,
    [Parameter(Mandatory = $true)][string]$Prompt,
    [string]$Data = "data\tinyshakespeare_3000.txt",
    [int]$MaxNewTokens = 64,
    [double]$Temperature = 1.0,
    [string]$Device = "cpu",
    [string]$Exe = ""
)

$root = Split-Path -Parent $PSScriptRoot
# The CPU target is the default because it does not import torch_cuda.dll.
# Pass -Exe build\memoria_gen.exe (or -Device cuda) for the CUDA target.
if (-not $Exe) {
    $Exe = if ($Device -eq "cuda") { "build\memoria_gen.exe" } else { "build\memoria_gen_cpu.exe" }
}
$exePath = if ([IO.Path]::IsPathRooted($Exe)) { $Exe } else { Join-Path $root $Exe }
$dataPath = if ([IO.Path]::IsPathRooted($Data)) { $Data } else { Join-Path $root $Data }
$checkpointPath = if ([IO.Path]::IsPathRooted($Checkpoint)) { $Checkpoint } else { Join-Path $root $Checkpoint }

if (-not (Test-Path -LiteralPath $exePath)) {
    throw "memoria_gen.exe not found: $exePath (run ops\scripts\build.ps1 first)"
}
if (-not (Test-Path -LiteralPath $checkpointPath)) {
    throw "checkpoint not found: $checkpointPath"
}
if (-not (Test-Path -LiteralPath $dataPath)) {
    throw "training data not found: $dataPath"
}

$torchLib = $env:MEMORIA_TORCH_LIB
if (-not $torchLib) {
    $torchLib = "D:\venv\Lib\site-packages\torch\lib"
}
if (Test-Path -LiteralPath $torchLib) {
    $env:PATH = "$torchLib;$env:PATH"
}
# OpenBLAS asks for a large thread pool by default. One worker keeps a CPU
# generation run inside a small commit budget while the desktop stays open.
if (-not $env:OPENBLAS_NUM_THREADS) { $env:OPENBLAS_NUM_THREADS = "1" }
if (-not $env:OMP_NUM_THREADS) { $env:OMP_NUM_THREADS = "1" }

& $exePath --load $checkpointPath --data $dataPath --prompt $Prompt `
    --max-new-tokens $MaxNewTokens --temperature $Temperature --device $Device
exit $LASTEXITCODE
