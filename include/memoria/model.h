#pragma once

#include <torch/torch.h>

#include <tuple>
#include <vector>

#include "memoria/chain_unit.h"
#include "memoria/config.h"
#include "memoria/embedding_layer.h"
#include "memoria/gated_valve.h"
#include "memoria/strata_memory.h"
#include "memoria/tri_balancer.h"

namespace memoria {

struct MemoriaOutput {
    torch::Tensor logits;
    torch::Tensor q_final;
    torch::Tensor k_final;
    torch::Tensor v_final;
    torch::Tensor current_embedding;
    torch::Tensor markers;  // [batch, seq, marker_dim], not fed to the main path
    double qk_similarity = 0.0;
    double v_fused_mean = 0.0;
};

class MemoriaModelImpl : public torch::nn::Module {
public:
    explicit MemoriaModelImpl(MemoriaConfig config = MemoriaConfig());

    MemoriaOutput forward(torch::Tensor input_ids, int64_t num_cycles = 1);

    const MemoriaConfig& config() const { return config_; }

private:
    torch::Tensor adjust_v_by_qk_relation(const torch::Tensor& q,
                                          const torch::Tensor& k,
                                          const torch::Tensor& v,
                                          int64_t unit_id,
                                          int64_t cycle);
    torch::Tensor post_process_v(const torch::Tensor& q,
                                 const torch::Tensor& k,
                                 const torch::Tensor& v,
                                 int64_t cycle);
    torch::Tensor apply_v_regularization(const torch::Tensor& v);
    double check_v_health(const torch::Tensor& v1,
                          const torch::Tensor& v2,
                          const torch::Tensor& v3,
                          const torch::Tensor& v_fused) const;

    MemoriaConfig config_;
    VRegularizationParams v_params_;

    EmbeddingLayer embedding_layer_{nullptr};
    GatedValve gated_valve_{nullptr};
    std::vector<ChainUnit> chain_units_;
    std::vector<TriBalancer> tri_balancers_;
    StrataMemory strata_memory_{nullptr};
    torch::nn::Sequential cycle_projection_{nullptr};
    torch::nn::LayerNorm layer_norm_{nullptr};
    torch::nn::Linear output_projection_{nullptr};
};
TORCH_MODULE(MemoriaModel);

}  // namespace memoria
