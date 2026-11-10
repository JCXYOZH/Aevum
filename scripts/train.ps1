#Requires -Version 5.1
# Start a training run in the background and write the exact log/metric paths
# the desktop monitor reads. Run scripts\desktop.ps1 first, then this file.

[CmdletBinding(PositionalBinding=$false)]
param(
    [string]$Data = "data\tinyshakespeare_3000.txt",
    [string]$Save = "build\checkpoint_dashboard",
    [int]$Epochs = 4,
    [int]$Batch = 32,
    [int]$SeqLen = 16,
    [int]$Vocab = 3000,
    [int]$Dim = 64,
    [string]$Device = "cuda",
    [int]$MaxSteps = 0,
    [switch]$NoMetrics,
    [switch]$Wait
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Exe = Join-Path $Root "build\memoria_train.exe"
$TorchLib = if ($env:MEMORIA_TORCH_LIB) { $env:MEMORIA_TORCH_LIB } else { "D:\venv\Lib\site-packages\torch\lib" }
$OutLog = Join-Path $Root "build\trainer.out.log"
$ErrLog = Join-Path $Root "build\trainer.err.log"
$Metrics = Join-Path $Root "build\training_metrics.jsonl"

if (-not (Test-Path -LiteralPath $Exe)) { throw "找不到 $Exe，先运行 scripts\build.ps1。" }
if (-not (Test-Path -LiteralPath (Join-Path $Root $Data))) {
    $DataPath = $Data
} else {
    $DataPath = Join-Path $Root $Data
}
if (-not (Test-Path -LiteralPath $DataPath)) { throw "数据文件不存在：$DataPath" }
if (-not $Save) { $Save = "build\checkpoint_dashboard" }
$SavePath = Join-Path $Root $Save
New-Item -ItemType Directory -Force -Path $SavePath | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutLog) | Out-Null

if (Test-Path -LiteralPath $TorchLib) {
    $env:PATH = "$TorchLib;$env:PATH"
}

$argsList = @(
    "--data", $DataPath,
    "--device", $Device,
    "--epochs", "$Epochs",
    "--batch", "$Batch",
    "--seq-len", "$SeqLen",
    "--vocab", "$Vocab",
    "--dim", "$Dim",
    "--save", $SavePath
)
if ($MaxSteps -gt 0) { $argsList += @("--max-steps", "$MaxSteps") }
if (-not $NoMetrics) { $argsList += @("--metrics", $Metrics) }

Write-Host "Starting: $Exe"
Write-Host "Metrics:  $Metrics"
Write-Host "Stdout:   $OutLog"
Write-Host "Stderr:   $ErrLog"
$proc = Start-Process -FilePath $Exe -ArgumentList $argsList `
    -WorkingDirectory $Root -WindowStyle Hidden `
    -RedirectStandardOutput $OutLog -RedirectStandardError $ErrLog -PassThru
Write-Host "PID:      $($proc.Id)"
if ($Wait) {
    $proc.WaitForExit()
    Write-Host "Exit code: $($proc.ExitCode)"
}
