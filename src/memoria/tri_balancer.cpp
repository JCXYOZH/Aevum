#include "include/memoria/tri_balancer.h"

namespace memoria {

TriBalancerImpl::TriBalancerImpl(int64_t dim) {
    // Raw scalars are pre-sigmoid controls; the forward applies sigmoid so they
    // stay in (0, 1). The starting values match 0.5 / 0.3 / 0.2 after the port.
    qk_balance_ = register_parameter("qk_balance", torch::tensor(0.5));
    v_balance_ = register_parameter("v_balance", torch::tensor(0.3));
    static_weight_ = register_parameter("static_weight", torch::tensor(0.2));
    // Each transform is a private d -> d projection, not a shared linear.
    q_transform_ = register_module("q_transform", torch::nn::Linear(dim, dim));
    k_transform_ = register_module("k_transform", torch::nn::Linear(dim, dim));
    v_transform_ = register_module("v_transform", torch::nn::Linear(dim, dim));
    density_history_ = register_buffer("density_history", torch::zeros({10}));
}

std::tuple<torch::Tensor, torch::Tensor, torch::Tensor> TriBalancerImpl::forward(
    const torch::Tensor& q,
    const torch::Tensor& k,
    const torch::Tensor& v,
    double* density_out) {
    // Norm share, not the raw vector magnitude. The 1e-8 avoids division by
    // zero when all three branches are exactly zero.
    auto q_norm = q.norm(2, -1, true);
    auto k_norm = k.norm(2, -1, true);
    auto v_norm = v.norm(2, -1, true);
    auto total = q_norm + k_norm + v_norm + 1e-8;
    auto q_ratio = q_norm / total;
    auto k_ratio = k_norm / total;
    auto v_ratio = v_norm / total;
    const double ideal = 1.0 / 3.0;
    auto density_tensor =
        1.0 - ((q_ratio - ideal).abs() + (k_ratio - ideal).abs() +
               (v_ratio - ideal).abs()).mean();
    double density = density_tensor.item<double>();
    if (density_out != nullptr) {
        *density_out = density;
    }

    // Keep a small ring of recent densities for diagnostics; it does not feed
    // back into the computation.
    density_history_.copy_(torch::roll(density_history_, {1}));
    density_history_.index_put_({0}, torch::tensor(density));

    // Q/K similarity decides how strongly V is generated from V itself.
    auto q_normed = q / (q.norm(2, -1, true) + 1e-8);
    auto k_normed = k / (k.norm(2, -1, true) + 1e-8);
    auto qk_dot = (q_normed * k_normed).sum(-1, true);
    auto m_r = torch::tanh(qk_dot);

    // V path: generate, transform, then keep 70% of the original V.
    auto v_weight = torch::sigmoid(v_balance_);
    auto v_generated = v * (1.0 + m_r * v_weight);
    auto v_transformed = v_transform_->forward(v_generated);
    auto v_balanced = v * 0.7 + v_transformed * 0.3;

    // Q/K path: each one is mixed with the average of V and the other one.
    auto qk_weight = torch::sigmoid(qk_balance_);
    auto q_with_vk = (v_balanced + k) / 2.0;
    auto q_transformed = q_transform_->forward(q_with_vk);
    auto q_balanced = qk_weight * q + (1.0 - qk_weight) * q_transformed;

    auto k_with_vq = (v_balanced + q) / 2.0;
    auto k_transformed = k_transform_->forward(k_with_vq);
    auto k_balanced = qk_weight * k + (1.0 - qk_weight) * k_transformed;

    // Static blend keeps a fixed fraction of the input, then a soft norm clamp
    // prevents one unit from dominating the next unit.
    auto static_factor = torch::sigmoid(static_weight_);
    auto q_final = static_factor * q_balanced + (1.0 - static_factor) * q;
    auto k_final = static_factor * k_balanced + (1.0 - static_factor) * k;
    auto v_final = static_factor * v_balanced + (1.0 - static_factor) * v;

    auto v_mean = v_final.mean().item<double>();
    if (v_mean > 2.0 || v_mean < 0.3) {
        auto scale = (v_mean > 2.0 ? 1.5 : 0.7) / v_mean;
        v_final = v_final * scale;
        q_final = q_final * scale;
        k_final = k_final * scale;
    }

    return {q_final, k_final, v_final};
}

}  // namespace memoria
