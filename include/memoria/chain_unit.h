#pragma once

#include <torch/torch.h>

#include <tuple>

#include "memoria/subnet.h"

namespace memoria {

// Three SubNets in a fixed order: V->K->Q, then Q->V->K, then K->Q->V.
// The three outputs are multiplied by separate weights, then mixed with a
// residual from the unit input. The V path is deliberately dominant (1.5).
class ChainUnitImpl : public torch::nn::Module {
public:
    ChainUnitImpl(int64_t dim, int64_t unit_id);

    // Inputs and outputs are [batch, seq, dim].
    std::tuple<torch::Tensor, torch::Tensor, torch::Tensor> forward(
        const torch::Tensor& q,
        const torch::Tensor& k,
        const torch::Tensor& v);

private:
    SubNet subnet1_{nullptr};  // V -> K -> Q.
    SubNet subnet2_{nullptr};  // Q -> V -> K.
    SubNet subnet3_{nullptr};  // K -> Q -> V.

    torch::Tensor residual_alpha_;       // 0.1, shared by Q/K/V residual.
    torch::Tensor v_dominant_weight_;    // 1.5, keeps the V path strong.
    torch::Tensor k_weight_;             // 1.0.
    torch::Tensor q_weight_;             // 1.0.
    torch::Tensor v_history_;            // [3], diagnostics only.
};
TORCH_MODULE(ChainUnit);

}  // namespace memoria
