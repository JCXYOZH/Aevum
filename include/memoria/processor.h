#pragma once

#include <torch/torch.h>

#include "memoria/fixed_rms_norm.h"

namespace memoria {

// One refinement block for a [Q, K, V] concatenation.
// Shape: [N, 3d] -> Linear -> [N, 2d] -> FixedRMSNorm -> GELU
//        -> Linear -> [N, d] -> FixedRMSNorm -> Dropout(0.1).
// The 3d input is the three tensors concatenated on the last dimension.
class ProcessorImpl : public torch::nn::Module {
public:
    explicit ProcessorImpl(int64_t dim);

    torch::Tensor forward(const torch::Tensor& x);

private:
    // The wider hidden layer (2d) gives the block room to mix Q/K/V before
    // projecting back to the residual width d.
    torch::nn::Linear linear1_{nullptr};
    FixedRMSNorm norm1_{nullptr};
    torch::nn::Linear linear2_{nullptr};
    FixedRMSNorm norm2_{nullptr};
    torch::nn::Dropout dropout_{nullptr};  // Training-only, p=0.1.
};
TORCH_MODULE(Processor);

}  // namespace memoria
