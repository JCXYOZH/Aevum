// Standalone generation entry point. It loads a checkpoint and one text batch,
// then samples a continuation. No optimizer step is executed: `epochs` is fixed
// at zero so `Trainer::train()` is a no-op after the checkpoint has been loaded.
//
// The dashboard calls this executable instead of linking LibTorch into the
// monitor. That keeps the HTTP service free of CUDA initialization and makes the
// generation path testable from a terminal.

#include <cstdlib>
#include <exception>
#include <iostream>
#include <stdexcept>
#include <string>

#include "memoria/checkpoint.h"
#include "memoria/generator.h"
#include "memoria/text_dataset.h"
#include "memoria/trainer.h"

namespace {

struct ChatOptions {
    std::string load_dir;
    std::string data_path;
    std::string prompt;
    std::string device = "cpu";
    int64_t max_new_tokens = 64;
    int64_t min_new_tokens = 0;
    int64_t seq_len = 16;
    int64_t cycles = 1;
    double temperature = 1.0;
    bool force_char = false;
};

void print_usage() {
    std::cout
        << "memoria_gen --load DIR --data FILE --prompt TEXT [options]\n"
        << "  --max-new-tokens N   hard stop, default 64\n"
        << "  --min-new-tokens N   suppress EOS for the first N tokens\n"
        << "  --temperature F      sampling temperature, default 1.0\n"
        << "  --seq-len N          dataset segment width, default 16\n"
        << "  --cycles N           recurrent cycles, default 1\n"
        << "  --device cpu|cuda    default cpu\n"
        << "  --char               force character-level dataset\n";
}

std::string need_value(int& index, int argc, char** argv) {
    if (index + 1 >= argc) {
        throw std::invalid_argument("memoria_gen: missing value for " +
                                    std::string(argv[index]));
    }
    ++index;
    return argv[index];
}

ChatOptions parse_options(int argc, char** argv) {
    ChatOptions options;
    for (int i = 1; i < argc; ++i) {
        const std::string key = argv[i];
        if (key == "--help" || key == "-h") {
            print_usage();
            std::exit(0);
        } else if (key == "--load") {
            options.load_dir = need_value(i, argc, argv);
        } else if (key == "--data") {
            options.data_path = need_value(i, argc, argv);
        } else if (key == "--prompt") {
            options.prompt = need_value(i, argc, argv);
        } else if (key == "--device") {
            options.device = need_value(i, argc, argv);
        } else if (key == "--max-new-tokens") {
            options.max_new_tokens = std::stoll(need_value(i, argc, argv));
        } else if (key == "--min-new-tokens") {
            options.min_new_tokens = std::stoll(need_value(i, argc, argv));
        } else if (key == "--seq-len" || key == "--seq") {
            options.seq_len = std::stoll(need_value(i, argc, argv));
        } else if (key == "--cycles") {
            options.cycles = std::stoll(need_value(i, argc, argv));
        } else if (key == "--temperature") {
            options.temperature = std::stod(need_value(i, argc, argv));
        } else if (key == "--char") {
            options.force_char = true;
        } else {
            throw std::invalid_argument("memoria_gen: unknown option " + key);
        }
    }
    if (options.load_dir.empty()) {
        throw std::invalid_argument("memoria_gen: --load is required");
    }
    if (options.data_path.empty()) {
        throw std::invalid_argument("memoria_gen: --data is required");
    }
    if (options.prompt.empty()) {
        throw std::invalid_argument("memoria_gen: --prompt is required");
    }
    if (options.seq_len <= 0) {
        throw std::invalid_argument("memoria_gen: --seq-len must be positive");
    }
    if (options.max_new_tokens <= 0 || options.max_new_tokens > 2048) {
        throw std::invalid_argument(
            "memoria_gen: --max-new-tokens must be between 1 and 2048");
    }
    if (options.temperature < 0.05 || options.temperature > 5.0) {
        throw std::invalid_argument(
            "memoria_gen: --temperature must be between 0.05 and 5.0");
    }
    return options;
}

}  // namespace

// Progress markers go to stderr. They are small, unbuffered and survive a
// hard process exit, which is the only way to tell where the loader stopped.
void trace_stage(const char* stage) {
    std::cerr << "[memoria_gen] " << stage << std::endl;
}

int main(int argc, char** argv) {
    trace_stage("parse");
    try {
        const ChatOptions options = parse_options(argc, argv);
        trace_stage("checkpoint config");

        // Read the checkpoint config before constructing the dataset. The
        // vocabulary size decides how many tokens the dataset may keep; if the
        // two disagree Trainer::setup_model() will throw before weights load.
        const memoria::MemoriaConfig config =
            memoria::read_checkpoint_config(options.load_dir);

        memoria::TrainerOptions trainer_options;
        trainer_options.data_path = options.data_path;
        trainer_options.load_dir = options.load_dir;
        trainer_options.device = options.device;
        trainer_options.epochs = 0;  // Generation only; no parameter update.
        trainer_options.cycles = options.cycles;
        trainer_options.dataset.seq_length = options.seq_len;
        trainer_options.dataset.vocab_size = config.vocab_size;
        trainer_options.dataset.force_char_level = options.force_char;

        memoria::Trainer trainer(trainer_options);
        trace_stage("trainer ready");

        {
            const auto parameters = trainer.model()->parameters();
            std::cout << "param_device: "
                      << (parameters.empty() ? "none" : parameters[0].device().str())
                      << std::endl;
        }

        memoria::GenerationOptions generation;
        generation.max_new_tokens = options.max_new_tokens;
        generation.min_new_tokens = options.min_new_tokens;
        generation.temperature = options.temperature;
        generation.cycles = options.cycles;

        trace_stage("generator setup");
        memoria::TextGenerator generator(trainer.model(), trainer.dataset());
        trace_stage("generator run");
        const std::string text = generator.generate(options.prompt, generation);
        trace_stage("generator done");

        std::cout << "checkpoint: " << options.load_dir << std::endl;
        std::cout << "device: " << options.device << std::endl;
        std::cout << "generated: " << text << std::endl;
        return 0;
    } catch (const std::exception& error) {
        std::cerr << "memoria_gen: " << error.what() << std::endl;
        return 1;
    }
}
