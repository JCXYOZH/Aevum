#pragma once

#include <torch/torch.h>

#include <tuple>
#include <vector>

namespace memoria {

// Three-layer memory. Each layer holds 3 time slots, and each slot holds
// Q/K plus three V sub-values (the V sub-list has 3 entries).
//
// Shapes:
//   depth*_q / depth*_k : [3, dim]
//   depth*_v            : [3, 3, dim]
//   energy_*            : [3]
//   timestamps_*        : [3] int64
//
// The newest layer stores the current mean; the middle layer copies the newest
// when its energy is above 0.1; the deepest layer is overwritten by the middle
// when its energy falls below 0.1.
class StrataMemoryImpl : public torch::nn::Module {
public:
    explicit StrataMemoryImpl(int64_t dim);

    // Clear all slots and reset the step counter.
    void reset();
    void store(const std::vector<torch::Tensor>& q_list,
               const std::vector<torch::Tensor>& k_list,
               const std::vector<std::vector<torch::Tensor>>& v_list);
    std::tuple<torch::Tensor, torch::Tensor, torch::Tensor> retrieve(
        int64_t depth = 2,
        int64_t time_layer = 2);

    double energy_at(int64_t depth, int64_t time_layer) const;
    int64_t step() const { return step_; }

private:
    // D = 2m / ((N + 1) N), with m = number of cosine-similarity edges > 0.3.
    double compute_energy_by_density(const torch::Tensor& values) const;
    // Decay all energies by 0.7 before each write.
    void linear_decay();
    void shift_and_update(const std::vector<torch::Tensor>& q_list,
                          const std::vector<torch::Tensor>& k_list,
                          const std::vector<std::vector<torch::Tensor>>& v_list);

    int64_t dim_;
    int64_t step_ = 0;
    double decay_factor_ = 0.7;

    // Each depth has its own Q/K/V slots; they are registered as buffers, not
    // parameters, because the memory is state rather than trainable weights.
    torch::Tensor depth0_q_;
    torch::Tensor depth0_k_;
    torch::Tensor depth0_v_;
    torch::Tensor depth1_q_;
    torch::Tensor depth1_k_;
    torch::Tensor depth1_v_;
    torch::Tensor depth2_q_;
    torch::Tensor depth2_k_;
    torch::Tensor depth2_v_;

    torch::Tensor energy_depth0_;
    torch::Tensor energy_depth1_;
    torch::Tensor energy_depth2_;

    torch::Tensor timestamps_depth0_;
    torch::Tensor timestamps_depth1_;
    torch::Tensor timestamps_depth2_;
};
TORCH_MODULE(StrataMemory);

}  // namespace memoria
