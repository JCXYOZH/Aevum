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
#   MEMORIA_PCH=0 bash scripts/build-linux.sh --cpu-only   # disable precompiled header
#   MEMORIA_NCCL_LIB=/path/to/libnccl.so bash scripts/build-linux.sh
#
# Outputs:
#   build/linux/memoria_train
#   build/linux/memoria_gen
#   build/linux/memoria_gen_cpu
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="${MEMORIA_LINUX_BUILD:-$ROOT/build/linux}"
CXX="${CXX:-g++}"
CXX11_ABI="${MEMORIA_CXX11_ABI:-}"
CXX_STANDARD="${MEMORIA_CXX_STANDARD:-}"
OPT="${MEMORIA_OPT:--O2}"
JOBS="${JOBS:-$(nproc 2>/dev/null || echo 2)}"
PCH="${MEMORIA_PCH:-1}"
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

PYTHON_BIN="${MEMORIA_PYTHON:-python3}"
if [[ -z "${MEMORIA_TORCH_ROOT:-}" ]]; then
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

# torch's CUDA shared library has an undefined reference to NCCL. Some wheels
# (including AIStudio's cu128 build) do not put NCCL in torch/lib, so the
# linker needs the actual libnccl path. MEMORIA_NCCL_LIB wins; otherwise probe
# the torch wheel and the system linker cache.
NCCL_LIB="${MEMORIA_NCCL_LIB:-}"
if [[ -z "$NCCL_LIB" && -e "$MEMORIA_TORCH_ROOT/lib/libtorch_cuda.so" ]]; then
  for d in \
    "$MEMORIA_TORCH_ROOT/lib" \
    "$MEMORIA_TORCH_ROOT/../nvidia/nccl/lib" \
    "$MEMORIA_TORCH_ROOT/../../nvidia/nccl/lib"; do
    if [[ -d "$d" ]]; then
      candidate="$(ls -1 "$d"/libnccl.so* 2>/dev/null | sort -V | tail -n 1 || true)"
      if [[ -n "$candidate" ]]; then
        NCCL_LIB="$candidate"
        break
      fi
    fi
  done
fi
if [[ -z "$NCCL_LIB" && -e "$MEMORIA_TORCH_ROOT/lib/libtorch_cuda.so" ]] && command -v ldconfig >/dev/null 2>&1; then
  NCCL_LIB="$(ldconfig -p 2>/dev/null | awk '/libnccl\.so/{print $NF}' | sort -V | tail -n 1 || true)"
fi

NCCL_LINK=()
if [[ -n "$NCCL_LIB" && -e "$NCCL_LIB" ]]; then
  NCCL_LINK=("$NCCL_LIB" "-Wl,-rpath,$(dirname "$NCCL_LIB")")
  echo "== nccl:     $NCCL_LIB"
elif [[ -e "$MEMORIA_TORCH_ROOT/lib/libtorch_cuda.so" ]]; then
  # Keep the build usable on hosts without NCCL; single-GPU training does not
  # call NCCL, but linking torch_cuda still needs its undefined symbols.
  NCCL_LINK=("-Wl,--allow-shlib-undefined")
  echo "== nccl:     not found; allowing unresolved torch_cuda symbols" >&2
fi

# Match the C++ ABI of the installed torch wheel. Official PyTorch wheels are
# built with the C++11 ABI; MEMORIA_CXX11_ABI still overrides this probe.
if [[ -z "$CXX11_ABI" ]]; then
  CXX11_ABI="$("$PYTHON_BIN" -c 'import torch; print(int(torch._C._GLIBCXX_USE_CXX11_ABI))' 2>/dev/null || echo 1)"
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
  echo "  --clean ignored: object files are overwritten in place, nothing is deleted"
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
  metrics_calculator
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
  "-I$ROOT/src/memoria"
)
CXXFLAGS=(
  "-std=$CXX_STANDARD"
  "$OPT"
  -fPIC
  -DNDEBUG
  "-D_GLIBCXX_USE_CXX11_ABI=$CXX11_ABI"
  -Wno-deprecated-declarations
)

PCH_HEADER="$BUILD_DIR/obj/memoria_pch.h"
PCH_FLAG=()
if [[ "$PCH" == "1" ]]; then
  printf '#include <torch/torch.h>\n' > "$PCH_HEADER"
  echo "  build precompiled header (torch headers parsed once)"
  "$CXX" "${CXXFLAGS[@]}" "${INCLUDES[@]}" \
    -x c++-header "$PCH_HEADER" -o "$PCH_HEADER.gch"
  PCH_FLAG=(-include "$PCH_HEADER")
fi

echo "== compiler: $($CXX --version | head -n 1)"
echo "== standard: $CXX_STANDARD"
echo "== torch:    $MEMORIA_TORCH_ROOT"
echo "== output:   $BUILD_DIR"

COMMON_OBJECTS=()
echo "  compile ${#COMMON_SOURCES[@]} common sources with -j$JOBS (opt=$OPT)"
printf '%s\n' "${COMMON_SOURCES[@]}" | xargs -r -P "$JOBS" -I{} \
  "$CXX" "${CXXFLAGS[@]}" "${INCLUDES[@]}" "${PCH_FLAG[@]}" \
  -c "$ROOT/src/memoria/{}.cpp" -o "$BUILD_DIR/obj/{}.o"
for source in "${COMMON_SOURCES[@]}"; do
  COMMON_OBJECTS+=("$BUILD_DIR/obj/$source.o")
done

echo "  compile chat_main.cpp"
"$CXX" "${CXXFLAGS[@]}" "${INCLUDES[@]}" "${PCH_FLAG[@]}" -c "$ROOT/src/memoria/chat_main.cpp" -o "$BUILD_DIR/obj/gen_main.o"
if [[ "$CPU_ONLY" != "1" ]]; then
  echo "  compile main.cpp"
  "$CXX" "${CXXFLAGS[@]}" "${INCLUDES[@]}" "${PCH_FLAG[@]}" -c "$ROOT/src/memoria/main.cpp" -o "$BUILD_DIR/obj/train_main.o"
fi
echo "  compile cpu_cuda_stub.cpp"
"$CXX" "${CXXFLAGS[@]}" "${INCLUDES[@]}" "${PCH_FLAG[@]}" -c "$ROOT/src/memoria/cpu_cuda_stub.cpp" -o "$BUILD_DIR/obj/cpu_stub.o"

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
    -ltorch_cuda -ltorch -ltorch_cpu -lc10_cuda -lc10 -lpthread "${NCCL_LINK[@]}"
else
  echo "  (no libtorch_cuda.so; training target uses the CPU stub)"
  link_target "$BUILD_DIR/memoria_train" "train_main.o" 1 \
    -ltorch -ltorch_cpu -lc10 -lpthread
fi

echo "  link memoria_gen"
if [[ -e "$MEMORIA_TORCH_ROOT/lib/libtorch_cuda.so" ]]; then
  link_target "$BUILD_DIR/memoria_gen" "gen_main.o" 0 \
    -ltorch_cuda -ltorch -ltorch_cpu -lc10_cuda -lc10 -lpthread "${NCCL_LINK[@]}"
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
