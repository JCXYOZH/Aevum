// CPU-only link shim. The generation executable is normally built against
// torch_cuda.dll, but a machine under commit pressure cannot even load that
// DLL. This translation unit supplies the one CUDA symbol referenced by the
// shared Trainer object so a CPU-only executable can be linked without
// torch_cuda.lib or c10_cuda.lib. It returns zero devices; --device cuda then
// fails with the normal "no CUDA device" error instead of crashing.
#include <cstdint>

namespace c10 {
namespace cuda {
int8_t device_count() {
    return 0;
}
}  // namespace cuda
}  // namespace c10
