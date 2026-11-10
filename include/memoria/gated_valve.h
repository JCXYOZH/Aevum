#pragma once

#include <torch/torch.h>

#include <tuple>

namespace memoria {

// The first mixing stage after the embedding. Each branch keeps a gated
// copy of its input and mixes in a transformed version:
//   out = x * sigmoid(gate) + transform(x) * (1 - sigmoid(gate)).
// Q and V use a two-layer ReLU/Tanh transform; K uses one Tanh layer.
class GatedValveImpl : public torch::nn::Module {
public:
    explicit GatedValveImpl(int64_t dim);

    // Inputs and outputs are [batch, seq, dim].
    std::tuple<torch::Tensor, torch::Tensor, torch::Tensor> forward(
        const torch::Tensor& q,
        const torch::Tensor& k,
        const torch::Tensor& v);

private:
    // [1, 1, d] so the same gate broadcasts over batch and sequence.
    torch::Tensor gate_q_;
    torch::Tensor gate_k_;
    torch::Tensor gate_v_;

    torch::nn::Linear q_linear1_{nullptr};
    torch::nn::Linear q_linear2_{nullptr};
    torch::nn::Linear k_linear_{nullptr};
    torch::nn::Linear v_linear1_{nullptr};
    torch::nn::Linear v_linear2_{nullptr};
};
TORCH_MODULE(GatedValve);

}  // namespace memoria
