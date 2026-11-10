#include "memoria/fixed_rms_norm.h"

namespace memoria {

FixedRMSNormImpl::FixedRMSNormImpl(int64_t dim, double eps)
    : dim_(dim), eps_(eps) {}

torch::Tensor FixedRMSNormImpl::forward(const torch::Tensor& x) {
    // mean(..., keepdim=true) keeps [B, L, 1] so broadcasting stays explicit.
    auto rms = x.pow(2).mean({-1}, true).sqrt() + eps_;
    return x / rms;
}

}  // namespace memoria
