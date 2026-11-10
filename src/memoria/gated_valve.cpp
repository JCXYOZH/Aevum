#include "memoria/gated_valve.h"

namespace memoria {

GatedValveImpl::GatedValveImpl(int64_t dim) {
    // Gates start at 1.0, so sigmoid(gate) ~= 0.73: the branch begins mostly
    // as a copy of its input and learns how much transform to mix in.
    gate_q_ = register_parameter("gate_q", torch::ones({1, 1, dim}));
    gate_k_ = register_parameter("gate_k", torch::ones({1, 1, dim}));
    gate_v_ = register_parameter("gate_v", torch::ones({1, 1, dim}));

    // d -> d projections. Linear's default bias is kept, matching the Python
    // nn.Linear layers.
    q_linear1_ = register_module("q_linear1", torch::nn::Linear(dim, dim));
    q_linear2_ = register_module("q_linear2", torch::nn::Linear(dim, dim));
    k_linear_ = register_module("k_linear", torch::nn::Linear(dim, dim));
    v_linear1_ = register_module("v_linear1", torch::nn::Linear(dim, dim));
    v_linear2_ = register_module("v_linear2", torch::nn::Linear(dim, dim));
}

std::tuple<torch::Tensor, torch::Tensor, torch::Tensor> GatedValveImpl::forward(
    const torch::Tensor& q,
    const torch::Tensor& k,
    const torch::Tensor& v) {
    // Q: two layers with ReLU, then a residual gate.
    auto q_gate = torch::sigmoid(gate_q_);
    auto q_transformed = q_linear2_->forward(torch::relu(q_linear1_->forward(q)));
    auto q_out = q * q_gate + q_transformed * (1.0 - q_gate);

    // K: a single Tanh projection is enough; the gate still controls the mix.
    auto k_gate = torch::sigmoid(gate_k_);
    auto k_transformed = torch::tanh(k_linear_->forward(k));
    auto k_out = k * k_gate + k_transformed * (1.0 - k_gate);

    // V: two layers with ReLU; V is the branch later stages depend on most.
    auto v_gate = torch::sigmoid(gate_v_);
    auto v_transformed =
        torch::tanh(v_linear2_->forward(torch::relu(v_linear1_->forward(v))));
    auto v_out = v * v_gate + v_transformed * (1.0 - v_gate);

    return {q_out, k_out, v_out};
}

}  // namespace memoria
