#include "include/memoria/model.h"

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace memoria {

MemoriaModelImpl::MemoriaModelImpl(MemoriaConfig config) : config_(config) {
    if (config_.num_units != 3) {
        throw std::invalid_argument("Memoria: num_units must be 3");
    }
    embedding_layer_ = register_module(
        "embedding_layer",
        EmbeddingLayer(config_.vocab_size, config_.dim, config_.max_len));

    gated_valve_ = register_module("gated_valve", GatedValve(config_.dim));

    for (int64_t i = 0; i < config_.num_units; ++i) {
        chain_units_.push_back(ChainUnit(config_.dim, i));
        register_module("chain_unit_" + std::to_string(i), chain_units_.back());
        tri_balancers_.push_back(TriBalancer(config_.dim));
        register_module("tri_balancer_" + std::to_string(i), tri_balancers_.back());
    }

    strata_memory_ = register_module(
        "strata_memory", StrataMemory(config_.dim));

    cycle_projection_ = register_module(
        "cycle_projection",
        torch::nn::Sequential(
            torch::nn::Linear(config_.dim, config_.dim * 2),
            torch::nn::ReLU(),
            torch::nn::Linear(config_.dim * 2, config_.dim)));

    layer_norm_ = register_module(
        "layer_norm",
        torch::nn::LayerNorm(torch::nn::LayerNormOptions({config_.dim})));

    output_projection_ = register_module(
        "output_projection", torch::nn::Linear(config_.dim, config_.vocab_size));
}

MemoriaOutput MemoriaModelImpl::forward(torch::Tensor input_ids, int64_t num_cycles) {
    if (input_ids.dtype() != torch::kLong) {
        input_ids = input_ids.to(torch::kLong);
    }

    auto embedding_output = embedding_layer_->forward_with_markers(input_ids);
    auto base_emb = embedding_output.base_embeddings;
    std::vector<MemoriaOutput> all_cycle_results;

    for (int64_t cycle = 0; cycle < num_cycles; ++cycle) {
        torch::Tensor current_emb;
        if (cycle == 0) {
            current_emb = base_emb.clone();
        } else {
            auto prev = all_cycle_results.back();
            current_emb = torch::tanh(cycle_projection_->forward(prev.q_final));
        }

        auto q = current_emb.clone();
        auto k = current_emb.clone();
        auto v = current_emb.clone();
        auto [q0, k0, v0] = gated_valve_->forward(q, k, v);

        auto [q1, k1, v1] = chain_units_[0]->forward(q0, k0, v0);
        auto [qb1, kb1, vb1] = tri_balancers_[0]->forward(q1, k1, v1);
        vb1 = adjust_v_by_qk_relation(qb1, kb1, vb1, 1, cycle);

        auto [q2, k2, v2] = chain_units_[1]->forward(qb1, kb1, vb1);
        auto [qb2, kb2, vb2] = tri_balancers_[1]->forward(q2, k2, v2);
        vb2 = adjust_v_by_qk_relation(qb2, kb2, vb2, 2, cycle);

        auto [q3, k3, v3] = chain_units_[2]->forward(qb2, kb2, vb2);
        auto [qb3, kb3, vb3] = tri_balancers_[2]->forward(q3, k3, v3);
        vb3 = adjust_v_by_qk_relation(qb3, kb3, vb3, 3, cycle);

        // The three V sub-values are the value entering the unit, the weighted
        // intermediate, and the unit output.
        std::vector<torch::Tensor> v1_sub{
            v0.clone(), (v0 + vb1 * 0.7) / 1.7, vb1.clone()};
        std::vector<torch::Tensor> v2_sub{
            vb1.clone(), (vb1 + vb2 * 0.7) / 1.7, vb2.clone()};
        std::vector<torch::Tensor> v3_sub{
            vb2.clone(), (vb2 + vb3 * 0.7) / 1.7, vb3.clone()};

        strata_memory_->store(
            {qb1, qb2, qb3}, {kb1, kb2, kb3}, {v1_sub, v2_sub, v3_sub});

        auto depth = std::min<int64_t>(cycle, 2);
        auto time_layer = std::min<int64_t>(cycle, 2);
        auto [q_deep, k_deep, v_deep] =
            strata_memory_->retrieve(depth, time_layer);

        double vw0 = 0.6;
        double vw1 = 0.3;
        double vw2 = 0.1;
        if (cycle > 0) {
            std::vector<torch::Tensor> previous_v;
            for (const auto& item : all_cycle_results) {
                previous_v.push_back(item.v_final);
            }
            auto historical_v_mean =
                torch::stack(previous_v, 0).mean({0}).mean().item<double>();
            auto current_v_mean = vb3.mean().item<double>();
            if (current_v_mean > historical_v_mean * 1.2) {
                vw0 = 0.7;
                vw1 = 0.2;
                vw2 = 0.1;
            } else if (current_v_mean < historical_v_mean * 0.8) {
                vw0 = 0.5;
                vw1 = 0.4;
                vw2 = 0.1;
            }
        }

        auto q_fused = q_deep * 0.5 + qb3 * 0.3 + current_emb * 0.2;
        auto k_fused = k_deep * 0.5 + kb3 * 0.3 + current_emb * 0.2;
        auto v_fused = v_deep * vw0 + vb3 * vw1 + current_emb * vw2;

        v_fused = apply_v_regularization(v_fused);
        v_fused = post_process_v(q_fused, k_fused, v_fused, cycle);

        auto q_normalized = layer_norm_->forward(q_fused);
        auto logits = output_projection_->forward(q_normalized);

        MemoriaOutput result;
        result.logits = logits;
        result.q_final = q_fused;
        result.k_final = k_fused;
        result.v_final = v_fused;
        result.current_embedding = current_emb;
        result.markers = embedding_output.markers;
        auto q_flat = q3.flatten();
        auto k_flat = k3.flatten();
        auto q_unit = q_flat / (q_flat.norm() + 1e-8);
        auto k_unit = k_flat / (k_flat.norm() + 1e-8);
        result.qk_similarity = (q_unit * k_unit).sum().item<double>();
        result.v_fused_mean = v_fused.mean().item<double>();

        all_cycle_results.push_back(result);

        if (check_v_health(v1, v2, v3, v_fused) < 0.25) {
            break;
        }
    }

    return all_cycle_results.back();
}

torch::Tensor MemoriaModelImpl::adjust_v_by_qk_relation(
    const torch::Tensor& q,
    const torch::Tensor& k,
    const torch::Tensor& v,
    int64_t unit_id,
    int64_t cycle) {
    auto q_normed = q / (q.norm(2, -1, true) + 1e-8);
    auto k_normed = k / (k.norm(2, -1, true) + 1e-8);
    auto r_qk = (q_normed * k_normed).sum(-1, true);
    auto m_r = torch::tanh(r_qk);
    auto cycle_factor = std::max(0.5, 1.0 - static_cast<double>(cycle) * 0.1);

    torch::Tensor generated;
    if (unit_id == 1) {
        generated = v * (0.7 + 0.3 * m_r);
    } else if (unit_id == 2) {
        generated = v * (0.5 + 0.5 * m_r);
    } else {
        auto adjustment = torch::where(r_qk > 0.5, 1.2 * m_r, 0.8 * m_r);
        generated = v * (0.6 + 0.4 * adjustment);
    }

    generated = generated * cycle_factor;

    auto v_mean = generated.mean().item<double>();
    if (v_mean > 2.0) {
        generated = generated * (1.5 / v_mean);
    } else if (v_mean < 0.5) {
        generated = generated * (0.8 / v_mean);
    }

    return 0.7 * generated + 0.3 * v;
}

torch::Tensor MemoriaModelImpl::post_process_v(
    const torch::Tensor& q,
    const torch::Tensor& k,
    const torch::Tensor& v,
    int64_t cycle) {
    auto q_normed = q / (q.norm(2, -1, true) + 1e-8);
    auto k_normed = k / (k.norm(2, -1, true) + 1e-8);
    auto dot_product = (q_normed * k_normed).sum(-1);
    auto avg_similarity = dot_product.mean().item<double>();

    double adjustment = 1.0;
    if (avg_similarity > 0.7) {
        adjustment = 1.05;
    } else if (avg_similarity < 0.3) {
        adjustment = 0.95;
    }

    auto adjusted = v * adjustment;
    auto cycle_decay = std::max(0.85, 1.0 - static_cast<double>(cycle) * 0.03);
    adjusted = adjusted * cycle_decay;

    auto v_mean = adjusted.mean().item<double>();
    auto v_std = adjusted.std().item<double>();

    if (v_mean > 2.0 || v_std > 1.5) {
        auto scale_factor = 1.0 / (v_mean + 1e-8);
        scale_factor = std::clamp(scale_factor, 0.5, 2.0);
        adjusted = adjusted * scale_factor;
    } else if (v_mean < 0.5) {
        adjusted = adjusted * (0.8 / v_mean);
    }

    return adjusted;
}

torch::Tensor MemoriaModelImpl::apply_v_regularization(const torch::Tensor& v) {
    auto v_mean = v.mean().item<double>();
    torch::Tensor result = v;
    torch::NoGradGuard no_grad;
    if (v_mean > v_params_.max_v_mean) {
        result = v * (v_params_.target_v_mean / v_mean);
    } else if (v_mean < v_params_.min_v_mean) {
        result = v * (v_params_.target_v_mean / v_mean);
    }
    return result;
}

double MemoriaModelImpl::check_v_health(
    const torch::Tensor& v1,
    const torch::Tensor& v2,
    const torch::Tensor& v3,
    const torch::Tensor& v_fused) const {
    std::vector<double> means{
        v1.mean().item<double>(),
        v2.mean().item<double>(),
        v3.mean().item<double>(),
        v_fused.mean().item<double>()};

    double avg_change = 0.0;
    int count = 0;
    for (size_t i = 1; i < means.size(); ++i) {
        if (means[i - 1] != 0.0) {
            avg_change += std::abs(means[i] - means[i - 1]) / std::abs(means[i - 1]);
            ++count;
        }
    }
    if (count > 0) {
        avg_change /= static_cast<double>(count);
    }

    double score = 0.0;
    if (avg_change < 0.3) {
        score += 0.3;
    }
    if (means[3] > 0.3 && means[3] < 2.0) {
        score += 0.3;
    }
    if (v_fused.std().item<double>() < 1.0) {
        score += 0.2;
    }

    bool monotonic = true;
    for (size_t i = 0; i + 1 < means.size(); ++i) {
        if (means[i] > means[i + 1]) {
            monotonic = false;
            break;
        }
    }
    if (!monotonic) {
        score += 0.2;
    }

    return score;
}

}  // namespace memoria
