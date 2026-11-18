#pragma once

#include <torch/torch.h>

namespace memoria {

// FixedRMSNorm: x / (sqrt(mean(x^2, last_dim)) + eps).
// The epsilon is added after the square root, matching the Python baseline.
// There is no learnable scale or bias, so this layer only has two scalars.
class FixedRMSNormImpl : public torch::nn::Module {
public:
    explicit FixedRMSNormImpl(int64_t dim, double eps = 1e-6);

    // Input and output have the same shape. Normalization is over the last dim.
    torch::Tensor forward(const torch::Tensor& x);

private:
    int64_t dim_;   // Kept for parity and debugging; forward does not reshape.
    double eps_;    // Stabilizer added after sqrt, not inside it.
};
TORCH_MODULE(FixedRMSNorm);

}  // namespace memoria
