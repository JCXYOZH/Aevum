#include <torch/torch.h>

#include <algorithm>
#include <cstdlib>
#include <filesystem>
#include <iostream>
#include <memory>
#include <numeric>
#include <random>
#include <stdexcept>
#include <string>
#include <vector>

#include <include/aevum_core.h>

namespace {

struct Options {
    int64_t steps = 200;       // Synthetic path: optimizer steps.
    int64_t batch = 32;
    int64_t seq = 16;          // Synthetic sequence length.
    int64_t seq_len = 128;     // Text sequence length.
    int64_t vocab = 64;        // Synthetic vocabulary size; text default built from data.
    bool vocab_explicit = false;
    int64_t dim = 32;
    int64_t units = 3;
    int64_t cycles = 1;
    int64_t epochs = 1;
    int64_t max_steps = 0;
    int64_t max_samples = 0;
    int64_t max_eval_samples = 512;
    int64_t max_new_tokens = 32;
    int64_t min_new_tokens = 0;
    double lr = 0.003;
    double grad_clip = 1.0;
    double temperature = 1.0;
    std::string data_path;
    std::string data_list;
    std::string vocab_path;
    std::string load_dir;
    std::string save_dir;
    std::string metrics_path;
    std::string prompt;
    std::string probe_modules_dir;
    std::string device = "cpu";
    bool force_char = false;
    bool disguise = false;
};

std::string need_value(int& i, int argc, char** argv, const std::string& key) {
    if (i + 1 >= argc) {
        throw std::runtime_error("missing value for " + key);
    }
    return argv[++i];
}

Options parse_options(int argc, char** argv) {
    Options opt;
    for (int i = 1; i < argc; ++i) {
        const std::string key = argv[i];
        if (key == "--steps") opt.steps = std::stoll(need_value(i, argc, argv, key));
        else if (key == "--batch") opt.batch = std::stoll(need_value(i, argc, argv, key));
        else if (key == "--seq") opt.seq = std::stoll(need_value(i, argc, argv, key));
        else if (key == "--seq-len") opt.seq_len = std::stoll(need_value(i, argc, argv, key));
        else if (key == "--vocab") { opt.vocab = std::stoll(need_value(i, argc, argv, key)); opt.vocab_explicit = true; }
        else if (key == "--dim") opt.dim = std::stoll(need_value(i, argc, argv, key));
        else if (key == "--units") opt.units = std::stoll(need_value(i, argc, argv, key));
        else if (key == "--cycles") opt.cycles = std::stoll(need_value(i, argc, argv, key));
        else if (key == "--epochs") opt.epochs = std::stoll(need_value(i, argc, argv, key));
        else if (key == "--max-steps") opt.max_steps = std::stoll(need_value(i, argc, argv, key));
        else if (key == "--max-samples") opt.max_samples = std::stoll(need_value(i, argc, argv, key));
        else if (key == "--max-eval-samples") opt.max_eval_samples = std::stoll(need_value(i, argc, argv, key));
        else if (key == "--max-new-tokens") opt.max_new_tokens = std::stoll(need_value(i, argc, argv, key));
        else if (key == "--min-new-tokens") opt.min_new_tokens = std::stoll(need_value(i, argc, argv, key));
        else if (key == "--lr") opt.lr = std::stod(need_value(i, argc, argv, key));
        else if (key == "--grad-clip") opt.grad_clip = std::stod(need_value(i, argc, argv, key));
        else if (key == "--temperature") opt.temperature = std::stod(need_value(i, argc, argv, key));
        else if (key == "--data") opt.data_path = need_value(i, argc, argv, key);
        else if (key == "--data-list") opt.data_list = need_value(i, argc, argv, key);
        else if (key == "--vocab-file") opt.vocab_path = need_value(i, argc, argv, key);
        else if (key == "--load") opt.load_dir = need_value(i, argc, argv, key);
        else if (key == "--save") opt.save_dir = need_value(i, argc, argv, key);
        else if (key == "--metrics") opt.metrics_path = need_value(i, argc, argv, key);
        else if (key == "--prompt") opt.prompt = need_value(i, argc, argv, key);
        else if (key == "--probe-modules") opt.probe_modules_dir = need_value(i, argc, argv, key);
        else if (key == "--device") opt.device = need_value(i, argc, argv, key);
        else if (key == "--char") opt.force_char = true;
        else if (key == "--disguise") opt.disguise = true;
        else if (key == "--help") {
            std::cout
                << "memoria_train options:\n"
                << "  --steps N --batch N --seq N --vocab N --dim N --units 3 --cycles N\n"
                << "  --data FILE|DIR --data-list FILE --vocab-file FILE --seq-len N --epochs N\n"
                << "  --max-steps N --max-samples N --max-eval-samples N\n"
                << "  --lr F --grad-clip F --load DIR --save DIR --char\n"
                << "  --device cpu|cuda --metrics FILE\n"
                << "  --prompt TEXT --max-new-tokens N --min-new-tokens N --temperature F --disguise\n"
                << "  --probe-modules DIR\n";
            std::exit(0);
        } else {
            throw std::runtime_error("unknown option: " + key);
        }
    }
    if (opt.units != 3) {
        throw std::invalid_argument("Memoria currently requires --units 3");
    }
    return opt;
}

torch::Tensor make_synthetic_batch(int64_t batch,
                                   int64_t seq,
                                   int64_t vocab,
                                   int64_t offset) {
    auto input = torch::empty({batch, seq}, torch::kLong);
    auto target = torch::empty({batch, seq}, torch::kLong);
    for (int64_t b = 0; b < batch; ++b) {
        for (int64_t t = 0; t < seq; ++t) {
            auto token = (b * seq + t + offset) % vocab;
            input.index_put_({b, t}, token);
            target.index_put_({b, t}, (token + 1) % vocab);
        }
    }
    return torch::cat({input, target}, 0);
}

std::vector<std::string> synthetic_vocab(int64_t vocab_size) {
    std::vector<std::string> vocab;
    vocab.reserve(static_cast<size_t>(vocab_size));
    vocab.push_back("<PAD>");
    vocab.push_back("<UNK>");
    vocab.push_back("<BOS>");
    vocab.push_back("<EOS>");
    for (int64_t i = static_cast<int64_t>(vocab.size()); i < vocab_size; ++i) {
        vocab.push_back("token_" + std::to_string(i));
    }
    return vocab;
}

int64_t count_parameters(const memoria::MemoriaModel& model) {
    int64_t total = 0;
    for (const auto& p : model->parameters()) {
        total += p.numel();
    }
    return total;
}

bool same_output(const torch::Tensor& a, const torch::Tensor& b) {
    if (a.dim() != b.dim()) return false;
    for (int64_t i = 0; i < a.dim(); ++i) {
        if (a.size(i) != b.size(i)) return false;
    }
    return torch::allclose(a, b, 1e-6, 1e-6);
}

// Runs every architecture module through its own forward and its own
// save/load archive. This proves the port is modular, not only monolithic.
void run_module_probe(const std::string& directory) {
    std::filesystem::create_directories(directory);
    const int64_t d = 8;
    auto x = torch::randn({2, 3, d});
    auto ids = torch::tensor({{1, 2, 3, 4}, {5, 6, 7, 8}}, torch::kLong);

    {
        memoria::FixedRMSNorm a(d), b(d);
        a->eval(); b->eval();
        memoria::save_module(*a, (std::filesystem::path(directory) / "norm.pt").string());
        memoria::load_module(*b, (std::filesystem::path(directory) / "norm.pt").string());
        std::cout << "module norm forward_ok=" << same_output(a->forward(x), b->forward(x))
                  << std::endl;
    }
    {
        memoria::Processor a(d), b(d);
        a->eval(); b->eval();
        memoria::save_module(*a, (std::filesystem::path(directory) / "processor.pt").string());
        memoria::load_module(*b, (std::filesystem::path(directory) / "processor.pt").string());
        auto x3 = torch::cat({x, x, x}, -1);
        std::cout << "module processor forward_ok="
                  << same_output(a->forward(x3), b->forward(x3)) << std::endl;
    }
    {
        memoria::SubNet a(d, memoria::ChainOrder::kValueKeyQuery), b(d, memoria::ChainOrder::kValueKeyQuery);
        a->eval(); b->eval();
        memoria::save_module(*a, (std::filesystem::path(directory) / "subnet.pt").string());
        memoria::load_module(*b, (std::filesystem::path(directory) / "subnet.pt").string());
        auto ao = a->forward(x, x, x);
        auto bo = b->forward(x, x, x);
        std::cout << "module subnet forward_ok="
                  << (same_output(std::get<0>(ao), std::get<0>(bo)) &&
                      same_output(std::get<1>(ao), std::get<1>(bo)) &&
                      same_output(std::get<2>(ao), std::get<2>(bo)))
                  << std::endl;
    }
    {
        memoria::ChainUnit a(d, 0), b(d, 0);
        a->eval(); b->eval();
        memoria::save_module(*a, (std::filesystem::path(directory) / "chain_unit.pt").string());
        memoria::load_module(*b, (std::filesystem::path(directory) / "chain_unit.pt").string());
        auto ao = a->forward(x, x, x);
        auto bo = b->forward(x, x, x);
        std::cout << "module chain_unit forward_ok="
                  << (same_output(std::get<0>(ao), std::get<0>(bo)) &&
                      same_output(std::get<1>(ao), std::get<1>(bo)) &&
                      same_output(std::get<2>(ao), std::get<2>(bo)))
                  << std::endl;
    }
    {
        memoria::TriBalancer a(d), b(d);
        a->eval(); b->eval();
        memoria::save_module(*a, (std::filesystem::path(directory) / "balancer.pt").string());
        memoria::load_module(*b, (std::filesystem::path(directory) / "balancer.pt").string());
        auto ao = a->forward(x, x, x);
        auto bo = b->forward(x, x, x);
        std::cout << "module tri_balancer forward_ok="
                  << (same_output(std::get<0>(ao), std::get<0>(bo)) &&
                      same_output(std::get<1>(ao), std::get<1>(bo)) &&
                      same_output(std::get<2>(ao), std::get<2>(bo)))
                  << std::endl;
    }
    {
        memoria::GatedValve a(d), b(d);
        a->eval(); b->eval();
        memoria::save_module(*a, (std::filesystem::path(directory) / "valve.pt").string());
        memoria::load_module(*b, (std::filesystem::path(directory) / "valve.pt").string());
        auto ao = a->forward(x, x, x);
        auto bo = b->forward(x, x, x);
        std::cout << "module gated_valve forward_ok="
                  << (same_output(std::get<0>(ao), std::get<0>(bo)) &&
                      same_output(std::get<1>(ao), std::get<1>(bo)) &&
                      same_output(std::get<2>(ao), std::get<2>(bo)))
                  << std::endl;
    }
    {
        memoria::StrataMemory a(d), b(d);
        auto q = torch::randn({3, 2, 3, d});
        auto q0 = q.select(0, 0);
        auto q1 = q.select(0, 1);
        auto q2 = q.select(0, 2);
        a->store({q0, q1, q2}, {q0, q1, q2},
                 {{q0, q0, q0}, {q1, q1, q1}, {q2, q2, q2}});
        a->eval(); b->eval();
        memoria::save_module(*a, (std::filesystem::path(directory) / "memory.pt").string());
        memoria::load_module(*b, (std::filesystem::path(directory) / "memory.pt").string());
        auto av = a->retrieve(2, 2);
        auto bv = b->retrieve(2, 2);
        std::cout << "module strata_memory forward_ok="
                  << (same_output(std::get<0>(av), std::get<0>(bv)) &&
                      same_output(std::get<1>(av), std::get<1>(bv)) &&
                      same_output(std::get<2>(av), std::get<2>(bv)))
                  << std::endl;
    }
    {
        memoria::EmbeddingLayer a(20, d), b(20, d);
        a->eval(); b->eval();
        memoria::save_module(*a, (std::filesystem::path(directory) / "embedding.pt").string());
        memoria::load_module(*b, (std::filesystem::path(directory) / "embedding.pt").string());
        std::cout << "module embedding forward_ok="
                  << same_output(a->forward(ids), b->forward(ids)) << std::endl;
    }
}

}  // namespace

int main(int argc, char** argv) {
    Options opt;
    try {
        opt = parse_options(argc, argv);
    } catch (const std::exception& error) {
        std::cerr << "memoria_train: " << error.what() << std::endl;
        return 2;
    }

    torch::manual_seed(1234);

    if (!opt.probe_modules_dir.empty()) {
        try {
            run_module_probe(opt.probe_modules_dir);
            return 0;
        } catch (const std::exception& error) {
            std::cerr << "memoria_train: module probe failed: " << error.what()
                      << std::endl;
            return 1;
        }
    }

    if (!opt.data_path.empty() || !opt.data_list.empty()) {
        memoria::TrainerOptions trainer_options;
        trainer_options.data_path = opt.data_path;
        trainer_options.data_list = opt.data_list;
        trainer_options.load_dir = opt.load_dir;
        trainer_options.save_dir = opt.save_dir;
        trainer_options.metrics_path = opt.metrics_path;
        trainer_options.dataset.seq_length = opt.seq_len;
        trainer_options.dataset.vocab_size =
            opt.vocab_explicit ? opt.vocab : trainer_options.dataset.vocab_size;
        trainer_options.dataset.max_samples = opt.max_samples;
        trainer_options.dataset.vocab_path = opt.vocab_path;
        trainer_options.dataset.force_char_level = opt.force_char;
        trainer_options.dim = opt.dim;
        trainer_options.batch = opt.batch;
        trainer_options.epochs = opt.epochs;
        trainer_options.max_steps = opt.max_steps;
        trainer_options.max_eval_samples = opt.max_eval_samples;
        trainer_options.cycles = opt.cycles;
        trainer_options.lr = opt.lr;
        trainer_options.grad_clip = opt.grad_clip;
        trainer_options.disguise = opt.disguise;
        trainer_options.device = opt.device;

        try {
            memoria::Trainer trainer(trainer_options);
            std::cout << "memoria c++ text trainer:"
                      << " epochs=" << opt.epochs
                      << " batch=" << opt.batch
                      << " seq=" << opt.seq_len
                      << " vocab=" << trainer.config().vocab_size
                      << " dim=" << trainer.config().dim
                      << " cycles=" << opt.cycles
                      << " params=" << count_parameters(trainer.model()) << std::endl;

            if (!opt.prompt.empty()) {
                memoria::GenerationOptions generation;
                generation.max_new_tokens = opt.max_new_tokens;
                generation.min_new_tokens = opt.min_new_tokens;
                generation.temperature = opt.temperature;
                generation.cycles = opt.cycles;
                memoria::TextGenerator generator(trainer.model(), trainer.dataset());
                auto text = generator.generate(opt.prompt, generation);
                std::cout << "generated: " << text << std::endl;
            }

            trainer.train();

            if (!opt.save_dir.empty() && opt.epochs == 0) {
                if (opt.disguise) {
                    memoria::save_disguised_checkpoint(
                        trainer.model(), trainer.config(),
                        trainer.dataset().vocab(), opt.save_dir);
                } else {
                    memoria::save_checkpoint(trainer.model(), trainer.config(),
                                             trainer.dataset().vocab(),
                                             opt.save_dir);
                }
            }
            return 0;
        } catch (const std::exception& error) {
            std::cerr << "memoria_train: text path failed: " << error.what()
                      << std::endl;
            return 1;
        }
    }

    // Synthetic path: deterministic next-token task. It remains useful as a
    // fast forward/backward smoke test, not as an algorithm benchmark.
    memoria::MemoriaConfig config;
    if (!opt.load_dir.empty()) {
        config = memoria::read_checkpoint_config(opt.load_dir);
    } else {
        config.vocab_size = opt.vocab;
        config.dim = opt.dim;
        config.num_units = opt.units;
        config.max_loop = opt.cycles;
        config.max_len = std::max<int64_t>(512, opt.seq);
    }

    memoria::MemoriaModel model(config);
    if (!opt.load_dir.empty()) {
        memoria::load_checkpoint(model, opt.load_dir);
    }
    model->train();

    torch::optim::Adam optimizer(
        model->parameters(),
        torch::optim::AdamOptions(opt.lr).betas({0.9, 0.999}).eps(1e-8));

    std::cout << "memoria c++ training: mode=synthetic"
              << " steps=" << opt.steps
              << " batch=" << opt.batch
              << " seq=" << opt.seq
              << " vocab=" << config.vocab_size
              << " dim=" << config.dim
              << " units=" << config.num_units
              << " cycles=" << opt.cycles
              << " params=" << count_parameters(model) << std::endl;

    double first_loss = 0.0;
    double last_loss = 0.0;
    for (int64_t step = 0; step < opt.steps; ++step) {
        auto batch_data = make_synthetic_batch(
            opt.batch, opt.seq, config.vocab_size, step);
        auto input = batch_data.slice(0, 0, opt.batch);
        auto target = batch_data.slice(0, opt.batch, opt.batch * 2);

        auto output = model->forward(input, opt.cycles);
        auto loss = torch::nn::functional::cross_entropy(
            output.logits.reshape({-1, config.vocab_size}), target.reshape({-1}));

        optimizer.zero_grad();
        loss.backward();
        torch::nn::utils::clip_grad_norm_(model->parameters(), opt.grad_clip);
        optimizer.step();

        auto value = loss.item<double>();
        if (step == 0) first_loss = value;
        last_loss = value;
        if (step % 10 == 0 || step == opt.steps - 1) {
            std::cout << "step " << step << " loss " << value << std::endl;
        }
    }

    model->eval();
    torch::NoGradGuard no_grad;
    auto eval_data = make_synthetic_batch(opt.batch, opt.seq, config.vocab_size, 0);
    auto eval_input = eval_data.slice(0, 0, opt.batch);
    auto eval_target = eval_data.slice(0, opt.batch, opt.batch * 2);
    auto eval_output = model->forward(eval_input, opt.cycles);
    auto eval_loss = torch::nn::functional::cross_entropy(
        eval_output.logits.reshape({-1, config.vocab_size}), eval_target.reshape({-1}));
    std::cout << "first_loss=" << first_loss << " last_loss=" << last_loss
              << " eval_loss=" << eval_loss.item<double>() << std::endl;

    if (!opt.save_dir.empty()) {
        memoria::save_checkpoint(model, config, synthetic_vocab(config.vocab_size),
                                 opt.save_dir);
    }
    return 0;
}
