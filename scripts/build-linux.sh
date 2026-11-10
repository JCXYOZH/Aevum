#!/usr/bin/env bash
# Build the Memoria C++ targets on a Linux cloud host.
#
# This mirrors scripts/build.ps1 but does not depend on MSVC. It expects a
# PyTorch C++ distribution (the torch wheel's lib directory is enough) and a
# C++17-or-newer compiler. The language standard is taken from the torch
# headers, and can be overridden with MEMORIA_CXX_STANDARD.
#
# Usage:
#   bash scripts/build-linux.sh
#   MEMORIA_TORCH_ROOT=/opt/libtorch bash scripts/build-linux.sh
#   MEMORIA_TORCH_ROOT=/opt/libtorch bash scripts/build-linux.sh --clean
#   bash scripts/build-linux.sh --cpu-only          # only memoria_gen_cpu
#   MEMORIA_OPT=-O1 bash scripts/build-linux.sh --cpu-only
#   JOBS=4 bash scripts/build-linux.sh --cpu-only
#   MEMORIA_CXX_STANDARD=c++20 bash scripts/build-linux.sh --cpu-only
#
# Outputs:
#   build/linux/memoria_train
#   build/linux/memoria_gen
#   build/linux/memoria_gen_cpu
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="${MEMORIA_LINUX_BUILD:-$ROOT/build/linux}"
CXX="${CXX:-g++}"
CXX11_ABI="${MEMORIA_CXX11_ABI:-0}"
CXX_STANDARD="${MEMORIA_CXX_STANDARD:-}"
OPT="${MEMORIA_OPT:--O2}"
JOBS="${JOBS:-$(nproc 2>/dev/null || echo 2)}"
CPU_ONLY=0
CLEAN=0

for arg in "$@"; do
  case "$arg" in
    --clean) CLEAN=1 ;;
    --cpu-only) CPU_ONLY=1 ;;
    -h|--help)
      sed -n '2,20p' "$0"
      exit 0
      ;;
    *)
      echo "unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

if [[ -z "${MEMORIA_TORCH_ROOT:-}" ]]; then
  PYTHON_BIN="${MEMORIA_PYTHON:-python3}"
  MEMORIA_TORCH_ROOT="$("$PYTHON_BIN" -c 'import pathlib, torch; print(pathlib.Path(torch.__file__).resolve().parent)')"
fi

if [[ ! -d "$MEMORIA_TORCH_ROOT/include/torch" ]]; then
  echo "torch headers not found under: $MEMORIA_TORCH_ROOT" >&2
  echo "Set MEMORIA_TORCH_ROOT to the directory that contains include/ and lib/." >&2
  exit 3
fi
if [[ ! -d "$MEMORIA_TORCH_ROOT/lib" ]]; then
  echo "torch libraries not found under: $MEMORIA_TORCH_ROOT/lib" >&2
  exit 3
fi

# Torch 2.8+ headers may require C++20. Read that requirement from the headers
# instead of pinning a standard here; MEMORIA_CXX_STANDARD still overrides it.
if [[ -z "$CXX_STANDARD" ]]; then
  TORCH_ALL_H="$MEMORIA_TORCH_ROOT/include/torch/csrc/api/include/torch/all.h"
  if [[ -f "$TORCH_ALL_H" ]] && grep -q "C++20 or later compatible compiler is required" "$TORCH_ALL_H"; then
    CXX_STANDARD="c++20"
  else
    CXX_STANDARD="c++17"
  fi
fi
case "$CXX_STANDARD" in
  c++17|c++20|c++2a|c++2b|c++23) ;;
  *)
    echo "unsupported MEMORIA_CXX_STANDARD: $CXX_STANDARD (use c++17 or c++20)" >&2
    exit 2
    ;;
esac

if [[ "$CLEAN" == "1" ]]; then
  rm -rf "$BUILD_DIR/obj"
fi
mkdir -p "$BUILD_DIR/obj"

COMMON_SOURCES=(
  fixed_rms_norm
  processor
  subnet
  chain_unit
  tri_balancer
  gated_valve
  strata_memory
  embedding_layer
  text_dataset
  checkpoint
  module_io
  trainer
  generator
  model
)

INCLUDES=(
  "-I$MEMORIA_TORCH_ROOT/include"
  "-I$MEMORIA_TORCH_ROOT/include/torch/csrc/api/include"
  "-I$ROOT/include"
)
CXXFLAGS=(
  "-std=$CXX_STANDARD"
  "$OPT"
  -fPIC
  -DNDEBUG
  "-D_GLIBCXX_USE_CXX11_ABI=$CXX11_ABI"
  -Wno-deprecated-declarations
)

echo "== compiler: $($CXX --version | head -n 1)"
echo "== standard: $CXX_STANDARD"
echo "== torch:    $MEMORIA_TORCH_ROOT"
echo "== output:   $BUILD_DIR"

COMMON_OBJECTS=()
echo "  compile ${#COMMON_SOURCES[@]} common sources with -j$JOBS (opt=$OPT)"
printf '%s\n' "${COMMON_SOURCES[@]}" | xargs -r -P "$JOBS" -I{} \
  "$CXX" "${CXXFLAGS[@]}" "${INCLUDES[@]}" \
  -c "$ROOT/src/memoria/{}.cpp" -o "$BUILD_DIR/obj/{}.o"
for source in "${COMMON_SOURCES[@]}"; do
  COMMON_OBJECTS+=("$BUILD_DIR/obj/$source.o")
done

echo "  compile chat_main.cpp"
"$CXX" "${CXXFLAGS[@]}" "${INCLUDES[@]}" -c "$ROOT/src/memoria/chat_main.cpp" -o "$BUILD_DIR/obj/gen_main.o"
if [[ "$CPU_ONLY" != "1" ]]; then
  echo "  compile main.cpp"
  "$CXX" "${CXXFLAGS[@]}" "${INCLUDES[@]}" -c "$ROOT/src/memoria/main.cpp" -o "$BUILD_DIR/obj/train_main.o"
fi
echo "  compile cpu_cuda_stub.cpp"
"$CXX" "${CXXFLAGS[@]}" "${INCLUDES[@]}" -c "$ROOT/src/memoria/cpu_cuda_stub.cpp" -o "$BUILD_DIR/obj/cpu_stub.o"

link_target() {
  local output="$1"
  local main_object="$2"
  local use_stub="$3"
  shift 3
  local objects=("${COMMON_OBJECTS[@]}" "$BUILD_DIR/obj/$main_object")
  if [[ "$use_stub" == "1" ]]; then
    objects+=("$BUILD_DIR/obj/cpu_stub.o")
  fi
  "$CXX" -o "$output" "${objects[@]}" \
    -L"$MEMORIA_TORCH_ROOT/lib" \
    -Wl,-rpath,"$MEMORIA_TORCH_ROOT/lib" \
    "$@"
}

if [[ "$CPU_ONLY" == "1" ]]; then
  echo "  link memoria_gen_cpu"
  link_target "$BUILD_DIR/memoria_gen_cpu" "gen_main.o" 1 \
    -ltorch -ltorch_cpu -lc10 -lpthread
  echo "built: $BUILD_DIR/memoria_gen_cpu"
  exit 0
fi

echo "  link memoria_train"
if [[ -e "$MEMORIA_TORCH_ROOT/lib/libtorch_cuda.so" ]]; then
  link_target "$BUILD_DIR/memoria_train" "train_main.o" 0 \
    -ltorch_cuda -ltorch -ltorch_cpu -lc10_cuda -lc10 -lpthread
else
  echo "  (no libtorch_cuda.so; training target uses the CPU stub)"
  link_target "$BUILD_DIR/memoria_train" "train_main.o" 1 \
    -ltorch -ltorch_cpu -lc10 -lpthread
fi

echo "  link memoria_gen"
if [[ -e "$MEMORIA_TORCH_ROOT/lib/libtorch_cuda.so" ]]; then
  link_target "$BUILD_DIR/memoria_gen" "gen_main.o" 0 \
    -ltorch_cuda -ltorch -ltorch_cpu -lc10_cuda -lc10 -lpthread
else
  echo "  (no libtorch_cuda.so; generation target uses the CPU stub)"
  link_target "$BUILD_DIR/memoria_gen" "gen_main.o" 1 \
    -ltorch -ltorch_cpu -lc10 -lpthread
fi

# CPU target deliberately omits torch_cuda/c10_cuda. It uses the tiny
# c10::cuda::device_count stub so a CPU-only cloud host can still load and
# sample a checkpoint without a GPU runtime in the process.
echo "  link memoria_gen_cpu"
link_target "$BUILD_DIR/memoria_gen_cpu" "gen_main.o" 1 \
  -ltorch -ltorch_cpu -lc10 -lpthread

echo "built: $BUILD_DIR/memoria_train"
echo "built: $BUILD_DIR/memoria_gen"
echo "built: $BUILD_DIR/memoria_gen_cpu"
