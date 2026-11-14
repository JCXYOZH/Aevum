#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "memoria/config.h"
#include "memoria/model.h"

namespace memoria {

enum class CheckpointFormat {
    kMemoria,        // A directory written by this C++ port.
    kDisguisedBert,  // BERT-looking config.json and pytorch_model.bin.
    kUnknown,
};

// A checkpoint is a directory, not a single opaque file:
//   memoria_model.pt   LibTorch state dict, including buffers
//   memoria_optimizer.pt optimizer state, optional; needed for resume
//   trainer_state.txt  epoch / global_step, optional
//   config.json        human/Transformer-style metadata
//   memoria_config.txt key=value config used by the C++ loader
//   vocab.txt          one token per line
//
// The names are Memoria's own names. No legacy marker is written.
void save_checkpoint(const MemoriaModel& model,
                     const MemoriaConfig& config,
                     const std::vector<std::string>& vocab,
                     const std::string& directory);

// Full checkpoint, including optimizer state and the next epoch/step.
void save_checkpoint(const MemoriaModel& model,
                     const torch::optim::Optimizer& optimizer,
                     const MemoriaConfig& config,
                     const std::vector<std::string>& vocab,
                     const std::string& directory,
                     int64_t next_epoch,
                     int64_t global_step);

// Writes a BERT-looking directory. The weight file is still a LibTorch
// archive, so this is a C++ round trip, not a Python pickle. The disguise is
// only for layout/config compatibility and explicit format detection.
void save_disguised_checkpoint(const MemoriaModel& model,
                               const MemoriaConfig& config,
                               const std::vector<std::string>& vocab,
                               const std::string& directory);

CheckpointFormat detect_checkpoint_format(const std::string& directory);

// Reads memoria_config.txt, or falls back to config.json for a disguised
// directory. The caller must build a model with this config before loading.
MemoriaConfig read_checkpoint_config(const std::string& directory);

// Reads vocab.txt. Used when a text dataset is not supplied at load time.
std::vector<std::string> read_checkpoint_vocab(const std::string& directory);

// Loads model weights. If optimizer is non-null and its archive exists, the
// optimizer state is restored too; epoch/step are returned when pointers are
// non-null.
void load_checkpoint(MemoriaModel& model, const std::string& directory);
void load_checkpoint(MemoriaModel& model,
                     torch::optim::Optimizer* optimizer,
                     const std::string& directory,
                     int64_t* next_epoch = nullptr,
                     int64_t* global_step = nullptr);

}  // namespace memoria
