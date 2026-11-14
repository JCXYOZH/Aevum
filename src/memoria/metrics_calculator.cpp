#include <include/aevum_core.h>

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace memoria {

CoreMetricsCalculator::CoreMetricsCalculator(const MemoriaConfig& config)
    : config_(config) {}

double CoreMetricsCalculator::compute_state_change(
    const torch::Tensor& q_t,
    const torch::Tensor& k_t,
    const torch::Tensor& v_t,
    const torch::Tensor& q_prev,
    const torch::Tensor& k_prev,
    const torch::Tensor& v_prev,
    MetricNorm norm) const {
    torch::Tensor q_delta;
    torch::Tensor k_delta;
    torch::Tensor v_delta;
    if (norm == MetricNorm::kL1) {
        q_delta = torch::norm((q_t - q_prev).flatten(), 1);
        k_delta = torch::norm((k_t - k_prev).flatten(), 1);
        v_delta = torch::norm((v_t - v_prev).flatten(), 1);
    } else if (norm == MetricNorm::kFrobenius) {
        q_delta = torch::norm((q_t - q_prev).flatten(), 2);
        k_delta = torch::norm((k_t - k_prev).flatten(), 2);
        v_delta = torch::norm((v_t - v_prev).flatten(), 2);
    } else {
        q_delta = torch::norm((q_t - q_prev).flatten(), 2);
        k_delta = torch::norm((k_t - k_prev).flatten(), 2);
        v_delta = torch::norm((v_t - v_prev).flatten(), 2);
    }
    return (q_delta + k_delta + v_delta).item<double>();
}

std::pair<double, bool> CoreMetricsCalculator::detect_phase_transition(
    const torch::Tensor& q_t,
    const torch::Tensor& k_t,
    const torch::Tensor& v_t,
    const torch::Tensor& q_prev,
    const torch::Tensor& k_prev,
    const torch::Tensor& v_prev) {
    auto delta = compute_state_change(
        q_t, k_t, v_t, q_prev, k_prev, v_prev, MetricNorm::kFrobenius);
    auto is_transition = delta > config_.phase_threshold;
    if (is_transition) {
        transition_points_.push_back(
            {delta, static_cast<int64_t>(state_history_.size())});
    }
    return {delta, is_transition};
}

torch::Tensor CoreMetricsCalculator::stack_three_networks(
    const std::vector<torch::Tensor>& q_list,
    const torch::Tensor& weights) {
    if (q_list.size() != 3) {
        throw std::invalid_argument("Memoria: stack_three_networks needs 3 tensors");
    }
    for (size_t i = 1; i < q_list.size(); ++i) {
        if (q_list[i].sizes() != q_list[0].sizes()) {
            throw std::invalid_argument("Memoria: stacked tensors must share a shape");
        }
    }

    auto effective_weights = weights.defined()
                                 ? weights
                                 : torch::ones({3}, q_list[0].options());
    auto alpha = torch::softmax(effective_weights.to(q_list[0].dtype()), 0);
    auto stacked = torch::zeros_like(q_list[0]);
    for (size_t i = 0; i < q_list.size(); ++i) {
        stacked += alpha.select(0, static_cast<int64_t>(i)) * q_list[i];
    }
    return stacked;
}

torch::Tensor CoreMetricsCalculator::apply_one_way_valve(
    const torch::Tensor& h_in,
    ValveMode mode,
    int64_t gate_value) {
    if (mode == ValveMode::kDetach) {
        return h_in.detach();
    }
    if (gate_value != 0 && gate_value != 1) {
        throw std::invalid_argument("Memoria: gate value must be 0 or 1");
    }
    return gate_value == 0 ? torch::zeros_like(h_in) : h_in.clone();
}

void CoreMetricsCalculator::record_state(const torch::Tensor& q,
                                          const torch::Tensor& k,
                                          const torch::Tensor& v) {
    state_history_.push_back(
        {q.detach().clone(), k.detach().clone(), v.detach().clone(),
         static_cast<int64_t>(state_history_.size())});
}

std::vector<double> CoreMetricsCalculator::get_state_change_series(
    MetricNorm norm) const {
    std::vector<double> changes;
    for (size_t i = 1; i < state_history_.size(); ++i) {
        const auto& current = state_history_[i];
        const auto& previous = state_history_[i - 1];
        changes.push_back(compute_state_change(current.q, current.k, current.v,
                                               previous.q, previous.k,
                                               previous.v, norm));
    }
    return changes;
}

CoreMetricsCalculator::LearningPhase
CoreMetricsCalculator::analyze_learning_phases() const {
    LearningPhase result;
    result.total_steps = static_cast<int64_t>(state_history_.size());
    result.transition_points = static_cast<int64_t>(transition_points_.size());
    if (state_history_.size() < 2) {
        result.phase = "initial";
        return result;
    }

    auto changes = get_state_change_series(MetricNorm::kL2);
    if (changes.empty()) {
        result.phase = "initial";
        return result;
    }

    const size_t window = std::min<size_t>(5, changes.size());
    double sum = 0.0;
    for (size_t i = changes.size() - window; i < changes.size(); ++i) {
        sum += changes[i];
    }
    result.avg_change = sum / static_cast<double>(window);
    result.stability = 1.0 / (result.avg_change + 1e-6);

    if (result.avg_change > 25.0) {
        result.phase = "exploration";
    } else if (result.avg_change > 15.0) {
        result.phase = "learning";
    } else if (result.avg_change > 5.0) {
        result.phase = "stabilization";
    } else {
        result.phase = "convergence";
    }
    return result;
}

void CoreMetricsCalculator::reset() {
    state_history_.clear();
    transition_points_.clear();
}

}  // namespace memoria
