#pragma once

#include <torch/torch.h>

#include <tuple>

#include "memoria/processor.h"

namespace memoria {

// The three legal update orders. The names describe which tensor is refined
// first, second and third inside one SubNet.
enum class ChainOrder {
    kValueKeyQuery,   // V -> K -> Q
    kQueryValueKey,   // Q -> V -> K
    kKeyQueryValue,   // K -> Q -> V
};

// One sub-network. It contains three processors whose execution order is fixed
// by ChainOrder; each processor receives the current [Q, K, V] concatenation.
// The residual weights start at 0.1 so the block begins close to identity.
class SubNetImpl : public torch::nn::Module {
public:
    SubNetImpl(int64_t dim, ChainOrder order);

    // Inputs and outputs are [batch, seq, dim]. Each update is
    // x_new = x_old + res_weight * Processor(cat(...)).
    std::tuple<torch::Tensor, torch::Tensor, torch::Tensor> forward(
        const torch::Tensor& q,
        const torch::Tensor& k,
        const torch::Tensor& v);

private:
    ChainOrder order_;
    Processor first_{nullptr};   // First stage in the selected order.
    Processor second_{nullptr};  // Sees the first stage's updated tensor.
    Processor third_{nullptr};   // Sees both earlier updates.

    // Separate learnable scalars for Q/K/V. They are not shared between stages.
    torch::Tensor res_weight_q_;
    torch::Tensor res_weight_k_;
    torch::Tensor res_weight_v_;
};
TORCH_MODULE(SubNet);

}  // namespace memoria
