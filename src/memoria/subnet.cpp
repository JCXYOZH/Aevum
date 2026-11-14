#include "include/memoria/subnet.h"

namespace memoria {

SubNetImpl::SubNetImpl(int64_t dim, ChainOrder order) : order_(order) {
    // Three separate processors: each stage sees the tensor updated by the
    // previous stage, so they cannot share weights.
    first_ = register_module("first", Processor(dim));
    second_ = register_module("second", Processor(dim));
    third_ = register_module("third", Processor(dim));
    // 0.1 keeps the block close to identity at initialization.
    res_weight_q_ = register_parameter("res_weight_q", torch::tensor(0.1));
    res_weight_k_ = register_parameter("res_weight_k", torch::tensor(0.1));
    res_weight_v_ = register_parameter("res_weight_v", torch::tensor(0.1));
}

std::tuple<torch::Tensor, torch::Tensor, torch::Tensor> SubNetImpl::forward(
    const torch::Tensor& q,
    const torch::Tensor& k,
    const torch::Tensor& v) {
    auto batch = q.size(0);
    auto seq = q.size(1);
    auto dim = q.size(2);

    // Flatten [B, L, d] to [B*L, d]; processors operate token-wise, so batch
    // and sequence share the same linear weights.
    auto q_flat = q.reshape({batch * seq, dim});
    auto k_flat = k.reshape({batch * seq, dim});
    auto v_flat = v.reshape({batch * seq, dim});

    torch::Tensor q_new;
    torch::Tensor k_new;
    torch::Tensor v_new;

    if (order_ == ChainOrder::kValueKeyQuery) {
        // V -> K -> Q: each stage sees the tensor updated by the previous stage.
        v_new = v_flat + res_weight_v_ * first_->forward(torch::cat({q_flat, k_flat, v_flat}, -1));
        k_new = k_flat + res_weight_k_ * second_->forward(torch::cat({q_flat, k_flat, v_new}, -1));
        q_new = q_flat + res_weight_q_ * third_->forward(torch::cat({q_flat, k_new, v_new}, -1));
    } else if (order_ == ChainOrder::kQueryValueKey) {
        // Q -> V -> K.
        q_new = q_flat + res_weight_q_ * first_->forward(torch::cat({q_flat, k_flat, v_flat}, -1));
        v_new = v_flat + res_weight_v_ * second_->forward(torch::cat({q_new, k_flat, v_flat}, -1));
        k_new = k_flat + res_weight_k_ * third_->forward(torch::cat({q_new, k_flat, v_new}, -1));
    } else {
        // K -> Q -> V. The Python baseline builds the third input from q_new,
        // k_new and the original v_flat; this is intentional.
        k_new = k_flat + res_weight_k_ * first_->forward(torch::cat({q_flat, k_flat, v_flat}, -1));
        q_new = q_flat + res_weight_q_ * second_->forward(torch::cat({q_flat, k_new, v_flat}, -1));
        v_new = v_flat + res_weight_v_ * third_->forward(torch::cat({q_new, k_new, v_flat}, -1));
    }

    return {q_new.reshape({batch, seq, dim}),
            k_new.reshape({batch, seq, dim}),
            v_new.reshape({batch, seq, dim})};
}

}  // namespace memoria
