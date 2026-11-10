#pragma once

#include <torch/torch.h>

#include <tuple>

namespace memoria {

// Balances the norm share of Q, K and V inside one unit.
// density = 1 - mean(|q_ratio - 1/3| + |k_ratio - 1/3| + |v_ratio - 1/3|).
// Three learnable scalars control how much V is generated, how much Q/K are
// mixed with the opposite pair, and how much of the original tensor survives.
class TriBalancerImpl : public torch::nn::Module {
public:
    explicit TriBalancerImpl(int64_t dim);

    // Returns balanced Q, K, V. Density is exposed separately for logging.
    std::tuple<torch::Tensor, torch::Tensor, torch::Tensor> forward(
        const torch::Tensor& q,
        const torch::Tensor& k,
        const torch::Tensor& v,
        double* density_out = nullptr);

private:
    torch::Tensor qk_balance_;      // 0.5, sigmoid -> Q/K mix weight.
    torch::Tensor v_balance_;       // 0.3, sigmoid -> V generation weight.
    torch::Tensor static_weight_;   // 0.2, sigmoid -> static blend weight.
    torch::nn::Linear q_transform_{nullptr};  // d -> d.
    torch::nn::Linear k_transform_{nullptr};  // d -> d.
    torch::nn::Linear v_transform_{nullptr};  // d -> d.
    torch::Tensor density_history_;           // [10], diagnostics only.
};
TORCH_MODULE(TriBalancer);

}  // namespace memoria
