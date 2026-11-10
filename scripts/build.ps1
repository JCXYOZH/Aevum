param(
    [string]$TorchDir = "",
    [string]$VcVars = "",
    [string]$SdkDir = "",
    [string]$SdkVersion = ""
)

$ErrorActionPreference = "Stop"

# Every machine-dependent path can be overridden by a parameter or an
# environment variable; the fallback only keeps the original local setup usable.
if (-not $TorchDir) {
    $TorchDir = if ($env:MEMORIA_TORCH_DIR) { $env:MEMORIA_TORCH_DIR } else { "D:\venv\Lib\site-packages\torch" }
}
if (-not $VcVars) {
    $VcVars = if ($env:MEMORIA_VCVARS) { $env:MEMORIA_VCVARS } else { "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" }
}
if (-not $SdkDir) {
    $SdkDir = if ($env:MEMORIA_SDK_DIR) { $env:MEMORIA_SDK_DIR } else { "C:\Program Files (x86)\Windows Kits\10" }
}
if (-not $SdkVersion) {
    $SdkVersion = if ($env:MEMORIA_SDK_VERSION) { $env:MEMORIA_SDK_VERSION } else { "10.0.26100.0" }
}

$root = Split-Path -Parent $PSScriptRoot
$build = Join-Path $root "build"
New-Item -ItemType Directory -Force -Path $build | Out-Null

$vcvars = $VcVars
$sdk = $SdkDir
$sdkVersion = $SdkVersion
if (-not (Test-Path -LiteralPath $TorchDir)) {
    throw "TorchDir not found: $TorchDir"
}
if (-not (Test-Path -LiteralPath $vcvars)) {
    throw "vcvars64.bat not found: $vcvars"
}

$sources = @(
    "`"$root\src\memoria\fixed_rms_norm.cpp`"",
    "`"$root\src\memoria\processor.cpp`"",
    "`"$root\src\memoria\subnet.cpp`"",
    "`"$root\src\memoria\chain_unit.cpp`"",
    "`"$root\src\memoria\tri_balancer.cpp`"",
    "`"$root\src\memoria\gated_valve.cpp`"",
    "`"$root\src\memoria\strata_memory.cpp`"",
    "`"$root\src\memoria\embedding_layer.cpp`"",
    "`"$root\src\memoria\text_dataset.cpp`"",
    "`"$root\src\memoria\checkpoint.cpp`"",
    "`"$root\src\memoria\module_io.cpp`"",
    "`"$root\src\memoria\trainer.cpp`"",
    "`"$root\src\memoria\generator.cpp`"",
    "`"$root\src\memoria\model.cpp`""
) -join " "

$obj = Join-Path $build "obj"
$bat = @"
@echo off
call "$vcvars" >nul
set "CFLAGS=/nologo /std:c++17 /EHsc /MD /O1 /wd4267 /wd4244 /I"$sdk\Include\$sdkVersion\ucrt" /I"$sdk\Include\$sdkVersion\um" /I"$sdk\Include\$sdkVersion\shared" /I"$TorchDir\include" /I"$TorchDir\include\torch\csrc\api\include" /I"$root\include""

if not exist "$obj\common" mkdir "$obj\common"
for %%f in ($sources) do (
  cl %CFLAGS% /c "%%~f" /Fo"$obj\common\%%~nf.obj"
  if errorlevel 1 exit /b 1
)

cl %CFLAGS% /c "$root\src\memoria\main.cpp" /Fo"$obj\train_main.obj"
if errorlevel 1 exit /b 1
cl %CFLAGS% /c "$root\src\memoria\chat_main.cpp" /Fo"$obj\gen_main.obj"
if errorlevel 1 exit /b 1

rem CPU-only shim: the shared Trainer object references c10::cuda::device_count.
rem Linking this tiny translation unit lets the CPU generator resolve that
rem symbol without importing torch_cuda.dll or c10_cuda.dll.
cl %CFLAGS% /c "$root\src\memoria\cpu_cuda_stub.cpp" /Fo"$obj\cpu_stub.obj"
if errorlevel 1 exit /b 1

cl /nologo /Fe:"$build\memoria_train.exe" "$obj\common\*.obj" "$obj\train_main.obj" ^
 /link /LIBPATH:"$sdk\Lib\$sdkVersion\ucrt\x64" ^
 /LIBPATH:"$sdk\Lib\$sdkVersion\um\x64" ^
 /LIBPATH:"$TorchDir\lib" /INCLUDE:?warp_size@cuda@at@@YAHXZ torch_cuda.lib torch.lib torch_cpu.lib c10_cuda.lib c10.lib
if errorlevel 1 exit /b 1

cl /nologo /Fe:"$build\memoria_gen.exe" "$obj\common\*.obj" "$obj\gen_main.obj" ^
 /link /LIBPATH:"$sdk\Lib\$sdkVersion\ucrt\x64" ^
 /LIBPATH:"$sdk\Lib\$sdkVersion\um\x64" ^
 /LIBPATH:"$TorchDir\lib" /INCLUDE:?warp_size@cuda@at@@YAHXZ torch_cuda.lib torch.lib torch_cpu.lib c10_cuda.lib c10.lib
if errorlevel 1 exit /b 1

rem CPU target deliberately omits torch_cuda/c10_cuda. On a machine whose
rem page file cannot hold a second CUDA runtime this is the executable that
rem actually loads and samples a checkpoint.
cl /nologo /Fe:"$build\memoria_gen_cpu.exe" "$obj\common\*.obj" "$obj\gen_main.obj" "$obj\cpu_stub.obj" ^
 /link /LIBPATH:"$sdk\Lib\$sdkVersion\ucrt\x64" ^
 /LIBPATH:"$sdk\Lib\$sdkVersion\um\x64" ^
 /LIBPATH:"$TorchDir\lib" torch.lib torch_cpu.lib c10.lib
if errorlevel 1 exit /b 1
"@
$batPath = Join-Path $build "compile.bat"
Set-Content -LiteralPath $batPath -Value $bat -Encoding ascii

& "C:\Windows\System32\cmd.exe" /c $batPath
if ($LASTEXITCODE -ne 0) {
    throw "C++ build failed with exit code $LASTEXITCODE"
}
Write-Host "built: $build\memoria_train.exe"
Write-Host "built: $build\memoria_gen.exe"
Write-Host "built: $build\memoria_gen_cpu.exe"
