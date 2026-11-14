#include <include/aevum_core.h>

#include <torch/nn/functional.h>

namespace memoria {

ProcessorImpl::ProcessorImpl(int64_t dim) {
    // 3d is the concatenated [Q, K, V]; the 2d hidden width is the only place
    // the three branches are mixed before the projection back to d.
    linear1_ = register_module("linear1", torch::nn::Linear(dim * 3, dim * 2));
    norm1_ = register_module("norm1", FixedRMSNorm(dim * 2));
    linear2_ = register_module("linear2", torch::nn::Linear(dim * 2, dim));
    norm2_ = register_module("norm2", FixedRMSNorm(dim));
    dropout_ = register_module("dropout", torch::nn::Dropout(0.1));
}

torch::Tensor ProcessorImpl::forward(const torch::Tensor& x) {
    // W1 expands 3d -> 2d; the nonlinearity is the only place Q/K/V interact
    // before the residual projection back to d.
    auto h = linear1_->forward(x);
    h = norm1_->forward(h);
    h = torch::nn::functional::gelu(h);
    h = linear2_->forward(h);
    h = norm2_->forward(h);
    return dropout_->forward(h);
}

}  // namespace memoria
