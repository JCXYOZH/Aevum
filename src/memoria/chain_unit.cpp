#include <include/aevum_core.h>

namespace memoria {

ChainUnitImpl::ChainUnitImpl(int64_t dim, int64_t unit_id) {
    (void)unit_id;  // Reserved for per-unit naming/debugging; not used yet.
    // Fixed order per subnet: V->K->Q, Q->V->K, K->Q->V.
    subnet1_ = register_module("subnet1", SubNet(dim, ChainOrder::kValueKeyQuery));
    subnet2_ = register_module("subnet2", SubNet(dim, ChainOrder::kQueryValueKey));
    subnet3_ = register_module("subnet3", SubNet(dim, ChainOrder::kKeyQueryValue));

    // The V branch is deliberately stronger; Q/K share a small residual.
    residual_alpha_ = register_parameter("residual_alpha", torch::tensor(0.1));
    v_dominant_weight_ = register_parameter("v_dominant_weight", torch::tensor(1.5));
    k_weight_ = register_parameter("k_weight", torch::tensor(1.0));
    q_weight_ = register_parameter("q_weight", torch::tensor(1.0));
    v_history_ = register_buffer("v_history", torch::zeros({3}));
}

std::tuple<torch::Tensor, torch::Tensor, torch::Tensor> ChainUnitImpl::forward(
    const torch::Tensor& q,
    const torch::Tensor& k,
    const torch::Tensor& v) {
    // q_in/k_in/v_in are the residual anchors. They must be clones because the
    // following SubNets may write into their own outputs, not into these.
    auto q_in = q.clone();
    auto k_in = k.clone();
    auto v_in = v.clone();

    // The three subnets are intentionally different orders, not repeats of
    // the same block.
    auto [q11, k11, v11] = subnet1_->forward(q, k, v);
    auto [q12, k12, v12] = subnet2_->forward(q11, k11, v11);
    auto [q13, k13, v13] = subnet3_->forward(q12, k12, v12);

    // V is the dominant output; Q/K stay closer to their residual.
    auto q_out = q13 * q_weight_ + residual_alpha_ * q_in;
    auto k_out = k13 * k_weight_ + residual_alpha_ * k_in;
    auto v_out = v13 * v_dominant_weight_ + residual_alpha_ * v_in;

    // Buffers are diagnostics: they record what each stage produced.
    v_history_.index_put_({0}, v11.mean().detach());
    v_history_.index_put_({1}, v12.mean().detach());
    v_history_.index_put_({2}, v13.mean().detach());

    return {q_out, k_out, v_out};
}

}  // namespace memoria
