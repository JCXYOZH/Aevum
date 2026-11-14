#include "include/memoria/generator.h"

#include <limits>
#include <stdexcept>

namespace memoria {

TextGenerator::TextGenerator(MemoriaModel& model, const TextDataset& dataset)
    : model_(model), dataset_(dataset) {}

std::string TextGenerator::generate(const std::string& prompt,
                                    const GenerationOptions& options) const {
    if (options.max_new_tokens <= 0) {
        return prompt;
    }

    auto ids = dataset_.encode_text(prompt, /*add_bos=*/true, /*add_eos=*/false);
    if (ids.empty()) {
        ids.push_back(2);  // BOS
    }

    const bool was_training = model_->is_training();
    model_->eval();
    torch::manual_seed(options.seed);

    // The sampler follows the model's device; otherwise a CUDA-trained model
    // would receive CPU input ids on the first step.
    auto params = model_->parameters();
    const torch::Device device = params.empty() ? torch::kCPU : params[0].device();

    {
        torch::NoGradGuard no_grad;
        for (int64_t step = 0; step < options.max_new_tokens; ++step) {
            auto input = torch::tensor(ids, torch::kLong).unsqueeze(0).to(device);
            auto output = model_->forward(input, options.cycles);
            // logits: [1, seq, vocab]; the next token is predicted from the
            // last position only.
            auto last = output.logits.select(1, output.logits.size(1) - 1).squeeze(0);
            if (options.temperature > 0.0) {
                last = last / options.temperature;
            }
            // A model trained on short segments learns to emit EOS very early.
            // For a readable continuation, keep EOS out of the first
            // min_new_tokens steps; this only masks the stop token, it does
            // not change any other logit.
            if (step < options.min_new_tokens) {
                last[3] = -std::numeric_limits<float>::infinity();
            }
            auto probs = torch::softmax(last, 0);
            auto next = torch::multinomial(probs, 1).item<int64_t>();

            if (next == 3) {  // EOS
                break;
            }
            ids.push_back(next);
        }
    }

    model_->train(was_training);
    return dataset_.decode_ids(ids);
}

}  // namespace memoria
