#pragma once

#include <cstdint>

namespace memoria {

// Configuration names are Memoria's own names. Do not reintroduce legacy names
// from the Python reference into this public surface.
struct MemoriaConfig {
    int64_t vocab_size = 10000;
    int64_t dim = 32;
    int64_t num_units = 3;
    int64_t geo_depth = 3;
    int64_t max_loop = 3;
    int64_t max_len = 512;
    double phase_threshold = 0.80;
    double v_scaling_factor = 1.0;
    double min_q_concepts = 1.0;
    int64_t history_length = 10;
};

struct VRegularizationParams {
    double max_v_mean = 2.0;
    double min_v_mean = 0.5;
    double target_v_mean = 1.0;
    double similarity_threshold = 0.3;
    double adjustment_strength = 0.1;
    double cycle_decay_rate = 0.95;
};

}  // namespace memoria
