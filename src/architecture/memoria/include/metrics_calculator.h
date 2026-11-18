#pragma once

#include <torch/torch.h>

#include <cstdint>
#include <string>
#include <utility>
#include <vector>

#include "config.h"

namespace memoria {

enum class MetricNorm {
    kL2,
    kL1,
    kFrobenius,
};

enum class ValveMode {
    kDetach,
    kGate,
};

// Port of config.py's CoreMetricsCalculator. It keeps the same four formulas:
// state change, phase transition, three-network stacking, and the one-way
// valve. The Python model only recorded state; this class exposes the other
// formulas so the C++ model can use or inspect them.
class CoreMetricsCalculator {
public:
    struct State {
        torch::Tensor q;
        torch::Tensor k;
        torch::Tensor v;
        int64_t step = 0;
    };

    struct TransitionPoint {
        double delta = 0.0;
        int64_t timestamp = 0;
    };

    struct LearningPhase {
        std::string phase;
        double avg_change = 0.0;
        int64_t total_steps = 0;
        int64_t transition_points = 0;
        double stability = 0.0;
    };

    explicit CoreMetricsCalculator(const MemoriaConfig& config = MemoriaConfig());

    // delta = ||Q_t-Q_{t-1}|| + ||K_t-K_{t-1}|| + ||V_t-V_{t-1}||
    double compute_state_change(const torch::Tensor& q_t,
                                const torch::Tensor& k_t,
                                const torch::Tensor& v_t,
                                const torch::Tensor& q_prev,
                                const torch::Tensor& k_prev,
                                const torch::Tensor& v_prev,
                                MetricNorm norm = MetricNorm::kL2) const;

    // Uses the Frobenius norm and config.phase_threshold. A transition is
    // appended to transition_points_ when delta > threshold.
    std::pair<double, bool> detect_phase_transition(
        const torch::Tensor& q_t,
        const torch::Tensor& k_t,
        const torch::Tensor& v_t,
        const torch::Tensor& q_prev,
        const torch::Tensor& k_prev,
        const torch::Tensor& v_prev);

    // Q_stack = sum(softmax(weights)[i] * Q_list[i]). Defaults to uniform.
    torch::Tensor stack_three_networks(
        const std::vector<torch::Tensor>& q_list,
        const torch::Tensor& weights = torch::Tensor());

    torch::Tensor apply_one_way_valve(const torch::Tensor& h_in,
                                      ValveMode mode = ValveMode::kDetach,
                                      int64_t gate_value = 1);

    void record_state(const torch::Tensor& q,
                      const torch::Tensor& k,
                      const torch::Tensor& v);

    std::vector<double> get_state_change_series(
        MetricNorm norm = MetricNorm::kL2) const;

    LearningPhase analyze_learning_phases() const;

    void reset();

    const std::vector<State>& state_history() const { return state_history_; }
    const std::vector<TransitionPoint>& transition_points() const {
        return transition_points_;
    }

private:
    MemoriaConfig config_;
    std::vector<State> state_history_;
    std::vector<TransitionPoint> transition_points_;
};

}  // namespace memoria
