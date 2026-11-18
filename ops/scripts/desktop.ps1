#Requires -Version 5.1
# Memoria desktop launcher: relay + desktop monitor + optional QEMU/bridge.
# Logs and pid state stay under build\desktop-logs, never in apps or src.

[CmdletBinding(PositionalBinding=$false)]
param(
    [switch]$Stop,
    [switch]$NoKernel,
    [switch]$NoBrowser,
    [switch]$Electron,
    [int]$RelayPort = 8790,
    [int]$MonitorPort = 8781,
    [int]$SerialPort = 5555,
    [int]$WsPort = 8765,
    [string]$Python = "",
    [string]$Qemu = ""
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$StateDir = Join-Path $Root "build\desktop-logs"
$LogDir = Join-Path $StateDir "logs"
$PidFile = Join-Path $StateDir "pids.json"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Test-Listen {
    param([int]$Port)
    return @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue).Count -gt 0
}

function Get-ListenPid {
    param([int]$Port)
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $conn) { return 0 }
    return [int]$conn.OwningProcess
}

function Stop-Tree {
    param([int]$ProcessId)
    $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$ProcessId" -ErrorAction SilentlyContinue)
    foreach ($child in $children) { Stop-Tree -ProcessId $child.ProcessId }
    Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
}

function Wait-Port {
    param([int]$Port, [int]$Seconds = 15)
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-Listen -Port $Port) { return $true }
        Start-Sleep -Milliseconds 250
    }
    return $false
}

function Start-DevProcess {
    param([string]$Name, [string]$FilePath, [string]$Arguments, [string]$WorkDir)
    $outLog = Join-Path $LogDir "$Name.out.log"
    $errLog = Join-Path $LogDir "$Name.err.log"
    $proc = Start-Process -FilePath $FilePath -ArgumentList $Arguments `
        -WorkingDirectory $WorkDir -WindowStyle Hidden `
        -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru
    $script:Started[$Name] = $proc.Id
    return $proc
}

function Stop-Dev {
    if (Test-Path -LiteralPath $PidFile) {
        try {
            $state = Get-Content -LiteralPath $PidFile -Raw | ConvertFrom-Json
            foreach ($entry in $state.services.PSObject.Properties) {
                $pidValue = [int]$entry.Value.pid
                if ($pidValue -gt 0) { Stop-Tree -ProcessId $pidValue }
            }
        } catch {
            Write-Host "状态文件无法读取，改为按端口清理。"
        }
        Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
    }

    foreach ($port in @($RelayPort, $MonitorPort, $SerialPort, $WsPort)) {
        $owner = Get-ListenPid -Port $port
        if ($owner -gt 0) {
            $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$owner" -ErrorAction SilentlyContinue
            if ($null -ne $proc -and $proc.CommandLine -match "relay|desktop_server|serial_bridge|qemu-system-i386") {
                Stop-Tree -ProcessId $owner
            }
        }
    }

    $leftovers = @(Get-CimInstance Win32_Process | Where-Object {
        $_.CommandLine -match "-m relay" -or
        $_.CommandLine -match "desktop_server\.py" -or
        $_.CommandLine -match "serial_bridge\.py"
    })
    foreach ($proc in $leftovers) { Stop-Tree -ProcessId $proc.ProcessId }

    Write-Host "Memoria desktop processes stopped."
}

if ($Stop) { Stop-Dev; return }

$ports = @($RelayPort, $MonitorPort)
if (-not $NoKernel) { $ports += @($SerialPort, $WsPort) }
foreach ($port in $ports) {
    if (Test-Listen -Port $port) {
        $owner = Get-ListenPid -Port $port
        throw "端口 $port 已被占用（PID $owner）。先运行 ops\scripts\desktop.ps1 -Stop，或手动停掉它。"
    }
}

if (-not $Python) {
    if ($env:MEMORIA_PYTHON) {
        $Python = $env:MEMORIA_PYTHON
    } elseif (Test-Path -LiteralPath "D:\venv\Scripts\python.exe") {
        $Python = "D:\venv\Scripts\python.exe"
    } else {
        $cmd = Get-Command python -ErrorAction SilentlyContinue
        if ($null -eq $cmd) { throw "找不到 python。先激活虚拟环境，或用 -Python 指定解释器路径。" }
        $Python = $cmd.Source
    }
}
if (-not (Test-Path -LiteralPath $Python)) { throw "Python 不存在：$Python" }
if (-not $NoKernel) {
    & $Python -c "import websockets" 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "当前 Python 没有 websockets。用 -Python 指定虚拟环境的 python.exe。" }
}

if (-not $NoKernel -and -not $Qemu) {
    if ($env:MEMORIA_QEMU) {
        $Qemu = $env:MEMORIA_QEMU
    } elseif ($env:QEMU_BIN) {
        $Qemu = $env:QEMU_BIN
    } else {
        $cmd = Get-Command qemu-system-i386 -ErrorAction SilentlyContinue
        if ($null -ne $cmd) { $Qemu = $cmd.Source }
        elseif (Test-Path -LiteralPath "C:\Program Files\qemu\qemu-system-i386.exe") { $Qemu = "C:\Program Files\qemu\qemu-system-i386.exe" }
        else { throw "找不到 qemu-system-i386。用 -Qemu 指定路径，或加 -NoKernel 只起页面与中继。" }
    }
}
if (-not $NoKernel -and -not (Test-Path -LiteralPath $Qemu)) { throw "QEMU 不存在：$Qemu" }

$RelayDir = Join-Path $Root "command\relay"
$WebDir = Join-Path $Root "interface\web"
$MonitorDir = Join-Path $Root "archive\backend-python\monitor"
$KernelDir = Join-Path $Root "src\kernel\host\console"
$BridgeDir = Join-Path $Root "src\kernel\host\bridge"
$ElectronDir = Join-Path $Root "interface\desktop"
foreach ($path in @($RelayDir, $WebDir, $MonitorDir, (Join-Path $MonitorDir "desktop_server.py"))) {
    if (-not (Test-Path -LiteralPath $path)) { throw "目录或文件不存在：$path" }
}
if (-not $NoKernel) {
    foreach ($path in @($KernelDir, $BridgeDir, (Join-Path $KernelDir "disk.img"), (Join-Path $BridgeDir "serial_bridge.py"))) {
        if (-not (Test-Path -LiteralPath $path)) { throw "目录或文件不存在：$path" }
    }
}

$script:Started = @{}
try {
    Start-DevProcess -Name "relay" -FilePath $Python `
        -Arguments "-X utf8 -m relay --port $RelayPort" -WorkDir $RelayDir | Out-Null
    if (-not (Wait-Port -Port $RelayPort)) { throw "中继没有起来，看 $LogDir\relay.err.log" }

    Start-DevProcess -Name "monitor" -FilePath $Python `
        -Arguments "-X utf8 desktop_server.py --port $MonitorPort --relay-port $RelayPort --bridge-port $WsPort --serial-port $SerialPort" -WorkDir $MonitorDir | Out-Null
    if (-not (Wait-Port -Port $MonitorPort)) { throw "桌面监控没有起来，看 $LogDir\monitor.err.log" }

    if (-not $NoKernel) {
        $qemuArgs = "-drive format=raw,file=disk.img -display none -monitor none -no-reboot " +
                    "-serial tcp:127.0.0.1:$SerialPort,server=on,wait=off"
        Start-DevProcess -Name "qemu" -FilePath $Qemu -Arguments $qemuArgs -WorkDir $KernelDir | Out-Null
        if (-not (Wait-Port -Port $SerialPort)) { throw "QEMU 串口没有起来，看 $LogDir\qemu.err.log" }

        Start-DevProcess -Name "bridge" -FilePath $Python `
            -Arguments "-X utf8 serial_bridge.py" -WorkDir $BridgeDir | Out-Null
        if (-not (Wait-Port -Port $WsPort)) { throw "串口桥接没有起来，看 $LogDir\bridge.err.log" }
    }

    $state = [ordered]@{
        root = $Root
        started_at = (Get-Date).ToString("s")
        services = [ordered]@{
            relay = @{ pid = [int]$script:Started["relay"]; port = $RelayPort }
            monitor = @{ pid = [int]$script:Started["monitor"]; port = $MonitorPort }
        }
    }
    if (-not $NoKernel) {
        $state.services.qemu = @{ pid = [int]$script:Started["qemu"]; port = $SerialPort }
        $state.services.bridge = @{ pid = [int]$script:Started["bridge"]; port = $WsPort }
    }
    [IO.File]::WriteAllText($PidFile, ($state | ConvertTo-Json -Depth 4), (New-Object Text.UTF8Encoding($false)))

    Write-Host ""
    Write-Host "Memoria desktop is up:"
    Write-Host "  desktop  http://127.0.0.1:$MonitorPort/"
    Write-Host "  relay    http://127.0.0.1:$RelayPort/v1/health"
    if (-not $NoKernel) { Write-Host "  kernel   tcp://127.0.0.1:$SerialPort  ->  ws://127.0.0.1:$WsPort" }
    Write-Host "  logs     $LogDir"
    Write-Host "  stop     ops\scripts\desktop.ps1 -Stop"
    Write-Host ""

    if ($Electron -and (Test-Path -LiteralPath (Join-Path $ElectronDir "node_modules\electron"))) {
        Start-Process -FilePath "npm" -ArgumentList "start" -WorkingDirectory $ElectronDir -WindowStyle Hidden | Out-Null
    } elseif (-not $NoBrowser) {
        Start-Process "http://127.0.0.1:$MonitorPort/"
    }
} catch {
    foreach ($name in $script:Started.Keys) { Stop-Tree -ProcessId ([int]$script:Started[$name]) }
    throw
}
