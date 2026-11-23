param(
  [string]$Distro = $env:AEVUM_WSL_DISTRO,
  [switch]$Check
)

$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$robot = Join-Path $repo "src\kernel\host\console\robot"

if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) {
  throw "wsl.exe not found. Install WSL, or run build-kernel.sh inside a Linux environment."
}
if (-not (Test-Path (Join-Path $robot "Makefile"))) {
  throw "Makefile not found under $robot"
}

$prefix = @()
if ($Distro) { $prefix = @("-d", $Distro) }

$winRobot = $robot -replace '\\', '/'
$wslRobot = (& wsl.exe @prefix wslpath -a $winRobot | Out-String).Trim()
if (-not $wslRobot -or $LASTEXITCODE -ne 0) {
  throw "wslpath failed for $robot"
}

$buildCmd = "cd '$wslRobot' && make clean && make all"
$wslArgs = @($prefix + @("--", "bash", "-lc", $buildCmd))

if ($Check) {
  Write-Output "repo:  $repo"
  Write-Output "wsl:   $wslRobot"
  Write-Output "cmd:   wsl.exe $($wslArgs -join ' ')"
  exit 0
}

& wsl.exe @wslArgs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
