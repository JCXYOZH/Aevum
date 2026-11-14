#pragma once

#include <cstdint>
#include <string>

#include "model.h"
#include "text_dataset.h"

namespace memoria {

struct GenerationOptions {
    int64_t max_new_tokens = 32;  // Hard stop; EOS can stop earlier.
    int64_t min_new_tokens = 0;   // Suppress EOS for this many tokens.
    int64_t cycles = 1;           // Same single-cycle default as training.
    double temperature = 1.0;     // 1.0 = model distribution; >1 flatter.
    int64_t seed = 1234;          // Sampling is seeded for reproducible smoke runs.
};

// Autoregressive sampler over Memoria logits. It is deliberately simple: one
// token at a time, no KV cache, because the first goal is to prove that a saved
// checkpoint can be loaded and produce a continuation.
class TextGenerator {
public:
    TextGenerator(MemoriaModel& model, const TextDataset& dataset);

    // Prompt is encoded with the dataset vocabulary; BOS is prepended and the
    // model is conditioned on the whole prompt each step.
    std::string generate(const std::string& prompt,
                         const GenerationOptions& options = {}) const;

private:
    MemoriaModel& model_;
    const TextDataset& dataset_;
};

}  // namespace memoria
