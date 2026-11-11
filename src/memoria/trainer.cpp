#include "memoria/trainer.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <stdexcept>

#include <torch/cuda.h>
#include <torch/nn/functional.h>
#include <torch/nn/utils/clip_grad.h>

namespace c10 {
namespace cuda {
// c10_cuda.dll exports this as a signed char (int8_t). Declared by hand
// because the public CUDAFunctions header pulls in <cuda.h>, which the
// wheel does not ship.
int8_t device_count();
}  // namespace cuda
}  // namespace c10

#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#endif

#include "memoria/checkpoint.h"

namespace memoria {

Trainer::Trainer(TrainerOptions options)
    : options_(std::move(options)), rng_(options_.seed) {
    std::vector<std::string> data_paths = options_.data_paths;

    // An explicit list is the canonical multi-shard form. Resolve relative
    // entries against the list file so a cloud-side train_files.txt works from
    // any current directory.
    if (data_paths.empty() && !options_.data_list.empty()) {
        std::ifstream list_in(options_.data_list);
        if (!list_in) {
            throw std::runtime_error(
                "Memoria: cannot open data list: " + options_.data_list);
        }
        const auto base = std::filesystem::path(options_.data_list).parent_path();
        std::string line;
        while (std::getline(list_in, line)) {
            if (!line.empty() && line.back() == '\r') line.pop_back();
            if (line.empty()) continue;
            std::filesystem::path path(line);
            if (path.is_relative() && !base.empty()) {
                path = base / path;
            }
            data_paths.push_back(path.string());
        }
    }

    if (data_paths.empty()) {
        if (options_.data_path.empty()) {
            throw std::invalid_argument("Memoria: Trainer needs --data or --data-list");
        }
        if (std::filesystem::is_directory(options_.data_path)) {
            for (const auto& entry :
                 std::filesystem::directory_iterator(options_.data_path)) {
                if (!entry.is_regular_file()) continue;
                const auto ext = entry.path().extension().string();
                if (ext == ".jsonl" || ext == ".json" || ext == ".txt") {
                    data_paths.push_back(entry.path().string());
                }
            }
            std::sort(data_paths.begin(), data_paths.end());
        } else {
            data_paths.push_back(options_.data_path);
        }
    }

    if (data_paths.empty()) {
        throw std::invalid_argument("Memoria: no data files found");
    }
    dataset_ = std::make_unique<TextDataset>(data_paths, options_.dataset);

    setup_model();
    // Generation-only runs (epochs == 0 and no save target) do not need an
    // optimizer. Skipping it also avoids restoring AdamW state that was
    // serialized on a different device than the one requested now.
    if (options_.epochs > 0 || !options_.save_dir.empty()) {
        setup_optimizer();
    }

    if (!options_.load_dir.empty()) {
        // A text vocabulary must line up exactly; otherwise token ids would
        // silently refer to different strings after a resume.
        auto checkpoint_vocab = read_checkpoint_vocab(options_.load_dir);
        auto current_vocab = dataset_->vocab();
        if (checkpoint_vocab.size() != current_vocab.size()) {
            throw std::runtime_error(
                "Memoria: checkpoint vocab size does not match dataset");
        }
        for (size_t i = 0; i < checkpoint_vocab.size(); ++i) {
            if (checkpoint_vocab[i] != current_vocab[i]) {
                throw std::runtime_error(
                    "Memoria: checkpoint vocab differs at index " +
                    std::to_string(i));
            }
        }
        load_checkpoint(model_, optimizer_.get(), options_.load_dir,
                        &next_epoch_, &global_step_);
        // load_checkpoint deserializes tensors onto CPU so a checkpoint saved
        // on CUDA can also be read on CPU-only hosts. Move the restored model
        // back to the requested device before the first forward pass.
        model_->to(device_);
    }
    open_metrics();
}

void Trainer::open_metrics() {
    if (options_.metrics_path.empty()) {
        return;
    }
    metrics_.open(options_.metrics_path, std::ios::out | std::ios::trunc);
    if (!metrics_.is_open()) {
        throw std::runtime_error(
            "Memoria: cannot open metrics file: " + options_.metrics_path);
    }
}

std::string Trainer::json_escape(const std::string& text) {
    std::string out;
    out.reserve(text.size() + 8);
    for (char c : text) {
        switch (c) {
            case '\\': out += "\\\\"; break;
            case '"': out += "\\\""; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default: out += c; break;
        }
    }
    return out;
}

void Trainer::write_metrics(const std::string& json) {
    if (!metrics_.is_open()) {
        return;
    }
    metrics_ << json << '\n';
    metrics_.flush();
}

int64_t Trainer::parameter_count() const {
    int64_t total = 0;
    for (const auto& p : model_->parameters()) {
        total += p.numel();
    }
    return total;
}

void Trainer::setup_model() {
    if (!options_.load_dir.empty()) {
        config_ = read_checkpoint_config(options_.load_dir);
        if (config_.vocab_size != dataset_->vocab_size()) {
            throw std::runtime_error(
                "Memoria: checkpoint vocab_size does not match dataset");
        }
    } else {
        config_ = MemoriaConfig();
        config_.vocab_size = dataset_->vocab_size();
        config_.dim = options_.dim;
        config_.num_units = 3;
        config_.geo_depth = 3;
        config_.max_loop = options_.cycles;
        config_.max_len = std::max<int64_t>(512, options_.dataset.seq_length);
    }
    model_ = MemoriaModel(config_);
    if (options_.device == "cuda") {
        // torch_cpu.dll exports a CPU-build stub for torch::cuda::is_available(),
        // which always returns false. Load the real CUDA extension and ask
        // c10_cuda for the device count instead.
#ifdef _WIN32
        if (LoadLibraryA("torch_cuda.dll") == nullptr) {
            throw std::runtime_error(
                "Memoria: cannot load torch_cuda.dll; add the torch lib "
                "directory to PATH");
        }
#endif
        if (c10::cuda::device_count() <= 0) {
            throw std::runtime_error(
                "Memoria: --device cuda requested, but no CUDA device is visible");
        }
        device_ = torch::kCUDA;
    } else if (options_.device == "cpu") {
        device_ = torch::kCPU;
    } else {
        throw std::runtime_error("Memoria: --device must be cpu or cuda");
    }
    model_->to(device_);
}

void Trainer::setup_optimizer() {
    torch::optim::AdamWOptions adamw(options_.lr);
    adamw.weight_decay(options_.weight_decay);
    adamw.betas({0.9, 0.999});
    adamw.eps(1e-8);
    optimizer_ = std::make_unique<torch::optim::AdamW>(
        model_->parameters(), adamw);
}

double Trainer::cosine_lr(int64_t epoch) const {
    if (options_.epochs <= 1) {
        return options_.lr;
    }
    const double eta_min = options_.lr * 0.01;
    const double progress =
        static_cast<double>(epoch) / static_cast<double>(options_.epochs);
    return eta_min + 0.5 * (options_.lr - eta_min) *
                        (1.0 + std::cos(3.14159265358979323846 * progress));
}

void Trainer::set_learning_rate(double lr) {
    for (auto& group : optimizer_->param_groups()) {
        group.options().set_lr(lr);
    }
}

torch::Tensor Trainer::masked_loss(const torch::Tensor& logits,
                                   const torch::Tensor& target) const {
    auto flat_logits = logits.view({-1, logits.size(-1)});
    auto flat_target = target.view({-1});
    // PAD is index 0 and is not part of the loss denominator.
    auto valid = flat_target != 0;
    auto losses = torch::nn::functional::cross_entropy(
        flat_logits, flat_target,
        torch::nn::functional::CrossEntropyFuncOptions().reduction(
            torch::kNone));
    return (losses * valid.to(losses.dtype())).sum() / valid.sum();
}

std::pair<double, int64_t> Trainer::train_one_epoch(
    int64_t epoch,
    const std::vector<size_t>& train_index,
    size_t total_samples) {
    model_->train();
    double epoch_loss = 0.0;
    int64_t epoch_tokens = 0;
    int64_t batches = 0;

    std::vector<size_t> order = train_index;
    std::shuffle(order.begin(), order.end(), rng_);

    for (size_t start = 0; start < order.size(); start += options_.batch) {
        const size_t end = std::min(order.size(), start + options_.batch);
        std::vector<torch::Tensor> inputs;
        std::vector<torch::Tensor> targets;
        for (size_t i = start; i < end; ++i) {
            auto sample = dataset_->sample(order[i]);
            inputs.push_back(sample.input_ids);
            targets.push_back(sample.target_ids);
        }
        auto input_ids = torch::stack(inputs, 0).to(device_);
        auto target_ids = torch::stack(targets, 0).to(device_);

        auto output = model_->forward(input_ids, options_.cycles);
        auto loss = masked_loss(output.logits, target_ids);

        optimizer_->zero_grad();
        loss.backward();
        torch::nn::utils::clip_grad_norm_(model_->parameters(), options_.grad_clip);
        optimizer_->step();

        const int64_t tokens = (target_ids != 0).sum().item<int64_t>();
        const double loss_value = loss.item<double>();
        epoch_loss += loss_value * static_cast<double>(tokens);
        epoch_tokens += tokens;
        ++batches;
        ++global_step_;

        const auto now = std::chrono::system_clock::now();
        const auto stamp = std::chrono::duration_cast<std::chrono::seconds>(
                               now.time_since_epoch())
                               .count();
        write_metrics(
            "{\"event\":\"step\",\"time\":" + std::to_string(stamp) +
            ",\"epoch\":" + std::to_string(epoch) +
            ",\"step\":" + std::to_string(global_step_) +
            ",\"loss\":" + std::to_string(loss_value) +
            ",\"tokens\":" + std::to_string(tokens) +
            ",\"lr\":" + std::to_string(cosine_lr(epoch)) + "}");

        if (batches % 10 == 0) {
            std::cout << "epoch " << epoch << " step " << global_step_
                      << " loss " << loss_value << std::endl;
        }
        if (options_.max_steps > 0 && global_step_ >= options_.max_steps) {
            break;
        }
    }

    const double avg = epoch_tokens > 0
                           ? epoch_loss / static_cast<double>(epoch_tokens)
                           : 0.0;
    if (first_loss_ == 0.0 && batches > 0) {
        first_loss_ = avg;
    }
    last_loss_ = avg;
    std::cout << "epoch " << epoch << " done batches=" << batches
              << " avg_loss=" << avg << " tokens=" << epoch_tokens
              << " samples=" << total_samples << std::endl;
    return {avg, epoch_tokens};
}

double Trainer::validate(const std::vector<size_t>& eval_index) {
    model_->eval();
    double total_loss = 0.0;
    int64_t total_tokens = 0;
    torch::NoGradGuard no_grad;

    for (size_t i = 0; i < eval_index.size(); ++i) {
        auto sample = dataset_->sample(eval_index[i]);
        auto output = model_->forward(sample.input_ids.unsqueeze(0).to(device_),
                                      options_.cycles);
        auto loss = masked_loss(
            output.logits, sample.target_ids.unsqueeze(0).to(device_));
        const int64_t tokens = (sample.target_ids != 0).sum().item<int64_t>();
        total_loss += loss.item<double>() * static_cast<double>(tokens);
        total_tokens += tokens;
    }

    model_->train();
    return total_tokens > 0 ? total_loss / static_cast<double>(total_tokens) : 0.0;
}

void Trainer::train() {
    const size_t total = dataset_->size();
    size_t train_size = std::max<size_t>(1, total * 9 / 10);
    if (train_size >= total) {
        train_size = total;
    }

    std::vector<size_t> train_index;
    std::vector<size_t> eval_index;
    for (size_t i = 0; i < total; ++i) {
        if (i < train_size) {
            train_index.push_back(i);
        } else {
            eval_index.push_back(i);
        }
    }
    if (eval_index.empty()) {
        eval_index = train_index;
    }
    if (options_.max_eval_samples > 0 &&
        static_cast<int64_t>(eval_index.size()) > options_.max_eval_samples) {
        eval_index.resize(static_cast<size_t>(options_.max_eval_samples));
    }

    std::cout << "trainer_start: total=" << total
              << " train=" << train_index.size()
              << " eval=" << eval_index.size()
              << " next_epoch=" << next_epoch_
              << " global_step=" << global_step_ << std::endl;

    const auto started_at = std::chrono::system_clock::now();
    const auto started_stamp =
        std::chrono::duration_cast<std::chrono::seconds>(
            started_at.time_since_epoch())
            .count();
    write_metrics(
        "{\"event\":\"start\",\"time\":" + std::to_string(started_stamp) +
        ",\"device\":\"" + json_escape(options_.device) +
        "\",\"epochs\":" + std::to_string(options_.epochs) +
        ",\"batch\":" + std::to_string(options_.batch) +
        ",\"seq_length\":" + std::to_string(options_.dataset.seq_length) +
        ",\"vocab\":" + std::to_string(dataset_->vocab_size()) +
        ",\"dim\":" + std::to_string(config_.dim) +
        ",\"params\":" + std::to_string(parameter_count()) +
        ",\"data\":\"" + json_escape(options_.data_list.empty()
                                         ? options_.data_path
                                         : options_.data_list) +
        "\",\"load\":\"" + json_escape(options_.load_dir) +
        "\",\"save\":\"" + json_escape(options_.save_dir) + "\"}");

    for (int64_t epoch = next_epoch_; epoch < options_.epochs; ++epoch) {
        set_learning_rate(cosine_lr(epoch));
        auto epoch_result = train_one_epoch(epoch, train_index, total);
        const double eval_loss = validate(eval_index);
        std::cout << "epoch " << epoch
                  << " train_loss=" << epoch_result.first
                  << " eval_loss=" << eval_loss
                  << " lr=" << cosine_lr(epoch) << std::endl;

        const auto now = std::chrono::system_clock::now();
        const auto stamp = std::chrono::duration_cast<std::chrono::seconds>(
                               now.time_since_epoch())
                               .count();
        write_metrics(
            "{\"event\":\"epoch\",\"time\":" + std::to_string(stamp) +
            ",\"epoch\":" + std::to_string(epoch) +
            ",\"train_loss\":" + std::to_string(epoch_result.first) +
            ",\"eval_loss\":" + std::to_string(eval_loss) +
            ",\"global_step\":" + std::to_string(global_step_) +
            ",\"lr\":" + std::to_string(cosine_lr(epoch)) + "}");

        next_epoch_ = epoch + 1;
        if (!options_.save_dir.empty()) {
            if (options_.disguise) {
                save_disguised_checkpoint(model_, config_, dataset_->vocab(),
                                          options_.save_dir);
            } else {
                save_checkpoint(model_, *optimizer_, config_, dataset_->vocab(),
                                options_.save_dir, next_epoch_, global_step_);
            }
        }
        if (options_.max_steps > 0 && global_step_ >= options_.max_steps) {
            break;
        }
    }

    std::cout << "trainer_done: first_loss=" << first_loss_
              << " last_loss=" << last_loss_
              << " global_step=" << global_step_ << std::endl;

    const auto finished_at = std::chrono::system_clock::now();
    const auto finished_stamp =
        std::chrono::duration_cast<std::chrono::seconds>(
            finished_at.time_since_epoch())
            .count();
    write_metrics(
        "{\"event\":\"done\",\"time\":" + std::to_string(finished_stamp) +
        ",\"first_loss\":" + std::to_string(first_loss_) +
        ",\"last_loss\":" + std::to_string(last_loss_) +
        ",\"global_step\":" + std::to_string(global_step_) + "}");
}

}  // namespace memoria
