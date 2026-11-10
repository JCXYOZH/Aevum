#include "memoria/strata_memory.h"

#include <algorithm>
#include <cmath>

namespace memoria {

StrataMemoryImpl::StrataMemoryImpl(int64_t dim) : dim_(dim) {
    // Buffers, not parameters: memory is state written by forward(), not a
    // trainable weight. Each depth has three slots and three V sub-values.
    depth0_q_ = register_buffer("depth0_q", torch::zeros({3, dim}));
    depth0_k_ = register_buffer("depth0_k", torch::zeros({3, dim}));
    depth0_v_ = register_buffer("depth0_v", torch::zeros({3, 3, dim}));
    depth1_q_ = register_buffer("depth1_q", torch::zeros({3, dim}));
    depth1_k_ = register_buffer("depth1_k", torch::zeros({3, dim}));
    depth1_v_ = register_buffer("depth1_v", torch::zeros({3, 3, dim}));
    depth2_q_ = register_buffer("depth2_q", torch::zeros({3, dim}));
    depth2_k_ = register_buffer("depth2_k", torch::zeros({3, dim}));
    depth2_v_ = register_buffer("depth2_v", torch::zeros({3, 3, dim}));

    // Energy starts at 1.0 so a fresh slot is considered alive; it decays by
    // 0.7 per step and is refreshed on write.
    energy_depth0_ = register_buffer("energy_depth0", torch::ones({3}));
    energy_depth1_ = register_buffer("energy_depth1", torch::ones({3}));
    energy_depth2_ = register_buffer("energy_depth2", torch::ones({3}));

    // Step numbers are int64 and only used for diagnostics/ordering.
    timestamps_depth0_ = register_buffer("timestamps_depth0", torch::zeros({3}, torch::kLong));
    timestamps_depth1_ = register_buffer("timestamps_depth1", torch::zeros({3}, torch::kLong));
    timestamps_depth2_ = register_buffer("timestamps_depth2", torch::zeros({3}, torch::kLong));
}

void StrataMemoryImpl::reset() {
    depth0_q_.zero_();
    depth0_k_.zero_();
    depth0_v_.zero_();
    depth1_q_.zero_();
    depth1_k_.zero_();
    depth1_v_.zero_();
    depth2_q_.zero_();
    depth2_k_.zero_();
    depth2_v_.zero_();
    energy_depth0_.fill_(1.0);
    energy_depth1_.fill_(1.0);
    energy_depth2_.fill_(1.0);
    timestamps_depth0_.zero_();
    timestamps_depth1_.zero_();
    timestamps_depth2_.zero_();
    step_ = 0;
}

double StrataMemoryImpl::compute_energy_by_density(const torch::Tensor& values) const {
    if (values.numel() == 0 || values.size(0) < 2) {
        return 1.0;
    }
    // Cosine similarity matrix; edges above 0.3 are counted once (undirected).
    auto n = values.size(0);
    auto values_norm = values / (values.norm(2, 1, true) + 1e-8);
    auto similarity = torch::mm(values_norm, values_norm.t());
    auto connections = (similarity > 0.3).to(torch::kFloat32);
    auto m = connections.sum().item<double>() / 2.0;
    auto density = (2.0 * m) / (static_cast<double>((n + 1) * n));
    return std::clamp(density, 0.0, 1.0);
}

void StrataMemoryImpl::linear_decay() {
    torch::NoGradGuard no_grad;
    energy_depth0_.mul_(decay_factor_);
    energy_depth1_.mul_(decay_factor_);
    energy_depth2_.mul_(decay_factor_);
}

void StrataMemoryImpl::shift_and_update(
    const std::vector<torch::Tensor>& q_list,
    const std::vector<torch::Tensor>& k_list,
    const std::vector<std::vector<torch::Tensor>>& v_list) {
    step_ += 1;

    // 1. Deepest layer repair: if a deep slot has decayed, copy the middle
    // slot and keep 80% of its energy.
    auto min_idx = energy_depth2_.argmin().item<int64_t>();
    auto min_energy = energy_depth2_.select(0, min_idx).item<double>();
    if (min_energy < 0.1 && energy_depth1_.select(0, min_idx).item<double>() > 0.1) {
        depth2_q_.index_put_({min_idx}, depth1_q_.select(0, min_idx).clone());
        depth2_k_.index_put_({min_idx}, depth1_k_.select(0, min_idx).clone());
        depth2_v_.index_put_({min_idx}, depth1_v_.select(0, min_idx).clone());
        energy_depth2_.index_put_(
            {min_idx}, energy_depth1_.select(0, min_idx).clone() * 0.8);
        timestamps_depth2_.index_put_({min_idx}, step_);
    }

    // 2. Middle layer <- newest layer, but only for slots that are still
    // active. The 0.9 factor is a deliberate loss of energy on promotion.
    for (int64_t i = 0; i < 3; ++i) {
        if (energy_depth0_.select(0, i).item<double>() > 0.1) {
            depth1_q_.index_put_({i}, depth0_q_.select(0, i).clone());
            depth1_k_.index_put_({i}, depth0_k_.select(0, i).clone());
            depth1_v_.index_put_({i}, depth0_v_.select(0, i).clone());
            energy_depth1_.index_put_(
                {i}, energy_depth0_.select(0, i).clone() * 0.9);
            timestamps_depth1_.index_put_({i}, step_);
        }
    }

    // 3. Newest layer stores the current batch/sequence mean. The energy is
    // computed from five vectors: Q, K, V1, V2, V3.
    int64_t layers = std::min<int64_t>(3, static_cast<int64_t>(q_list.size()));
    for (int64_t t = 0; t < layers; ++t) {
        if (!q_list[t].defined() || q_list[t].numel() == 0) {
            continue;
        }
        auto q_mean = q_list[t].mean(std::vector<int64_t>{0, 1});
        auto k_mean = k_list[t].mean(std::vector<int64_t>{0, 1});

        std::vector<torch::Tensor> v_means;
        for (int64_t vi = 0; vi < 3; ++vi) {
            if (vi < static_cast<int64_t>(v_list[t].size())) {
                v_means.push_back(v_list[t][vi].mean(std::vector<int64_t>{0, 1}));
            } else {
                v_means.push_back(torch::zeros_like(q_mean));
            }
        }

        depth0_q_.index_put_({t}, q_mean);
        depth0_k_.index_put_({t}, k_mean);
        depth0_v_.index_put_({t}, torch::stack(v_means, 0));
        timestamps_depth0_.index_put_({t}, step_);

        auto combined = torch::stack(
            {q_mean, k_mean, v_means[0], v_means[1], v_means[2]}, 0);
        energy_depth0_.index_put_({t}, torch::tensor(compute_energy_by_density(combined)));
    }
}

void StrataMemoryImpl::store(
    const std::vector<torch::Tensor>& q_list,
    const std::vector<torch::Tensor>& k_list,
    const std::vector<std::vector<torch::Tensor>>& v_list) {
    linear_decay();
    shift_and_update(q_list, k_list, v_list);
}

std::tuple<torch::Tensor, torch::Tensor, torch::Tensor> StrataMemoryImpl::retrieve(
    int64_t depth,
    int64_t time_layer) {
    torch::Tensor q_mem;
    torch::Tensor k_mem;
    torch::Tensor v_mem;
    if (depth == 0) {
        q_mem = depth0_q_;
        k_mem = depth0_k_;
        v_mem = depth0_v_;
    } else if (depth == 1) {
        q_mem = depth1_q_;
        k_mem = depth1_k_;
        v_mem = depth1_v_;
    } else {
        q_mem = depth2_q_;
        k_mem = depth2_k_;
        v_mem = depth2_v_;
    }
    // Memory is detached before it enters the current graph: it is a read-only
    // snapshot, not a gradient path into past steps.
    time_layer = std::min<int64_t>(time_layer, 2);
    auto q = q_mem.select(0, time_layer).detach().clone();
    auto k = k_mem.select(0, time_layer).detach().clone();
    // V has three sub-values per slot; index 2 is the final sub-value.
    auto v = v_mem.select(0, time_layer).select(0, 2).detach().clone();
    return {q, k, v};
}

double StrataMemoryImpl::energy_at(int64_t depth, int64_t time_layer) const {
    time_layer = std::min<int64_t>(time_layer, 2);
    if (depth == 0) {
        return energy_depth0_.select(0, time_layer).item<double>();
    }
    if (depth == 1) {
        return energy_depth1_.select(0, time_layer).item<double>();
    }
    return energy_depth2_.select(0, time_layer).item<double>();
}

}  // namespace memoria
