#pragma once

#include <cstdint>
#include <fstream>
#include <memory>
#include <random>
#include <string>
#include <utility>
#include <vector>

#include "memoria/config.h"
#include "memoria/model.h"
#include "memoria/text_dataset.h"

namespace memoria {

struct TrainerOptions {
    std::string data_path;       // One UTF-8 text/JSONL file, or a directory.
    std::string data_list;       // Optional text file with one shard path per line.
    std::vector<std::string> data_paths; // Optional explicit shard list.
    std::string load_dir;        // Resume from this checkpoint when non-empty.
    std::string save_dir;        // Save after every epoch when non-empty.
    std::string metrics_path;    // JSONL telemetry for the desktop monitor.
    std::string device = "cpu"; // "cpu" or "cuda".
    TextDatasetOptions dataset;  // seq_length / vocab_size / max_samples / vocab.
    int64_t dim = 32;            // Model width; units are fixed at 3.
    int64_t batch = 8;
    int64_t epochs = 1;
    int64_t max_steps = 0;       // 0 = run all batches in every epoch.
    int64_t max_eval_samples = 512; // Cap validation; full 10% is too expensive.
    int64_t cycles = 1;
    double lr = 0.003;
    double weight_decay = 1e-4;
    double grad_clip = 1.0;
    int64_t seed = 1234;
    bool disguise = false;       // Write BERT-shaped checkpoint files instead of the native pair.
};

// Text training loop, separated from main so the CLI does not own the
// optimizer or the checkpoint policy. It mirrors the Python trainer's
// AdamW(1e-4 weight decay) + cosine LR + ignore_index=0 loss.
class Trainer {
public:
    explicit Trainer(TrainerOptions options);

    void train();

    MemoriaModel& model() { return model_; }
    const MemoriaConfig& config() const { return config_; }
    TextDataset& dataset() { return *dataset_; }
    int64_t global_step() const { return global_step_; }

private:
    void setup_model();
    void setup_optimizer();
    std::pair<double, int64_t> train_one_epoch(
        int64_t epoch,
        const std::vector<size_t>& train_index,
        size_t total_samples);
    double validate(const std::vector<size_t>& eval_index);
    void set_learning_rate(double lr);
    double cosine_lr(int64_t epoch) const;
    torch::Tensor masked_loss(const torch::Tensor& logits,
                              const torch::Tensor& target) const;
    void open_metrics();
    void write_metrics(const std::string& json);
    static std::string json_escape(const std::string& text);
    int64_t parameter_count() const;

    TrainerOptions options_;
    std::unique_ptr<TextDataset> dataset_;
    MemoriaConfig config_;
    MemoriaModel model_{nullptr};
    torch::Device device_{torch::kCPU};
    std::unique_ptr<torch::optim::AdamW> optimizer_;
    std::ofstream metrics_;
    int64_t next_epoch_ = 0;
    int64_t global_step_ = 0;
    int64_t run_steps_ = 0;      // Steps in this process; --max-steps caps this.
    double first_loss_ = 0.0;
    double last_loss_ = 0.0;
    std::mt19937 rng_;
};

}  // namespace memoria
