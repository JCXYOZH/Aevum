#include "memoria/checkpoint.h"

#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <stdexcept>

namespace memoria {

namespace {

std::string join_path(const std::string& directory, const std::string& name) {
    return (std::filesystem::path(directory) / name).string();
}

std::string read_text_file(const std::string& path) {
    std::ifstream in(path, std::ios::binary);
    if (!in) {
        throw std::runtime_error("Memoria: cannot read " + path);
    }
    std::ostringstream buffer;
    buffer << in.rdbuf();
    return buffer.str();
}

bool file_exists(const std::string& path) {
    return std::filesystem::exists(path);
}

void write_config_text(const MemoriaConfig& config, const std::string& directory) {
    std::ofstream out(join_path(directory, "memoria_config.txt"));
    if (!out) {
        throw std::runtime_error("Memoria: cannot write memoria_config.txt");
    }
    out << "vocab_size=" << config.vocab_size << "\n";
    out << "dim=" << config.dim << "\n";
    out << "num_units=" << config.num_units << "\n";
    out << "geo_depth=" << config.geo_depth << "\n";
    out << "max_loop=" << config.max_loop << "\n";
    out << "max_len=" << config.max_len << "\n";
    out << std::setprecision(17);
    out << "phase_threshold=" << config.phase_threshold << "\n";
    out << "v_scaling_factor=" << config.v_scaling_factor << "\n";
    out << "min_q_concepts=" << config.min_q_concepts << "\n";
    out << "history_length=" << config.history_length << "\n";
}

void write_config_json(const MemoriaConfig& config,
                       const std::string& directory,
                       bool disguised) {
    std::ofstream out(join_path(directory, "config.json"));
    if (!out) {
        throw std::runtime_error("Memoria: cannot write config.json");
    }
    out << "{\n";
    if (disguised) {
        out << "  \"model_type\": \"bert\",\n";
        out << "  \"architectures\": [\"BertForMaskedLM\"],\n";
        out << "  \"attention_probs_dropout_prob\": 0.1,\n";
        out << "  \"hidden_act\": \"gelu\",\n";
    } else {
        out << "  \"model_type\": \"memoria\",\n";
        out << "  \"architectures\": [\"MemoriaModel\"],\n";
    }
    out << "  \"hidden_size\": " << config.dim << ",\n";
    out << "  \"num_hidden_layers\": " << config.num_units << ",\n";
    out << "  \"vocab_size\": " << config.vocab_size << ",\n";
    out << "  \"max_position_embeddings\": " << config.max_len << ",\n";
    if (disguised) {
        out << "  \"_is_memoria_disguised\": true,\n";
        out << "  \"_memoria_version\": \"0.2.0\",\n";
    } else {
        out << "  \"_is_memoria_checkpoint\": true,\n";
        out << "  \"_memoria_version\": \"0.2.0\",\n";
    }
    out << "  \"_memoria_config\": {\n";
    out << "    \"dim\": " << config.dim << ",\n";
    out << "    \"num_units\": " << config.num_units << ",\n";
    out << "    \"geo_depth\": " << config.geo_depth << ",\n";
    out << "    \"phase_threshold\": " << config.phase_threshold << "\n";
    out << "  }\n";
    out << "}\n";
}

void write_vocab(const std::vector<std::string>& vocab, const std::string& directory) {
    std::ofstream vocab_out(join_path(directory, "vocab.txt"));
    if (!vocab_out) {
        throw std::runtime_error("Memoria: cannot write vocab.txt");
    }
    for (const auto& token : vocab) {
        vocab_out << token << "\n";
    }
}

void write_trainer_state(int64_t next_epoch,
                         int64_t global_step,
                         const std::string& directory) {
    std::ofstream out(join_path(directory, "trainer_state.txt"));
    if (!out) {
        throw std::runtime_error("Memoria: cannot write trainer_state.txt");
    }
    out << "next_epoch=" << next_epoch << "\n";
    out << "global_step=" << global_step << "\n";
}

double find_json_number(const std::string& raw,
                        const std::string& key,
                        double fallback) {
    auto pos = raw.find("\"" + key + "\"");
    if (pos == std::string::npos) return fallback;
    pos = raw.find(':', pos);
    if (pos == std::string::npos) return fallback;
    try {
        return std::stod(raw.substr(pos + 1));
    } catch (...) {
        return fallback;
    }
}

bool find_json_bool(const std::string& raw, const std::string& key) {
    auto pos = raw.find("\"" + key + "\"");
    if (pos == std::string::npos) return false;
    pos = raw.find(':', pos);
    if (pos == std::string::npos) return false;
    return raw.find("true", pos) != std::string::npos;
}

}  // namespace

void save_checkpoint(const MemoriaModel& model,
                     const MemoriaConfig& config,
                     const std::vector<std::string>& vocab,
                     const std::string& directory) {
    std::filesystem::create_directories(directory);

    torch::serialize::OutputArchive archive;
    model->save(archive);
    archive.save_to(join_path(directory, "memoria_model.pt"));

    write_config_text(config, directory);
    write_config_json(config, directory, /*disguised=*/false);
    write_vocab(vocab, directory);

    int64_t params = 0;
    for (const auto& p : model->parameters()) {
        params += p.numel();
    }
    std::cout << "checkpoint_saved: " << directory
              << " params=" << params
              << " vocab=" << vocab.size() << std::endl;
}

void save_checkpoint(const MemoriaModel& model,
                     const torch::optim::Optimizer& optimizer,
                     const MemoriaConfig& config,
                     const std::vector<std::string>& vocab,
                     const std::string& directory,
                     int64_t next_epoch,
                     int64_t global_step) {
    save_checkpoint(model, config, vocab, directory);

    // The optimizer state is separate from the model archive: it contains
    // Adam moments and must be restored for an exact resume.
    torch::serialize::OutputArchive optimizer_archive;
    optimizer.save(optimizer_archive);
    optimizer_archive.save_to(join_path(directory, "memoria_optimizer.pt"));
    write_trainer_state(next_epoch, global_step, directory);
    std::cout << "trainer_state_saved: next_epoch=" << next_epoch
              << " global_step=" << global_step << std::endl;
}

void save_disguised_checkpoint(const MemoriaModel& model,
                               const MemoriaConfig& config,
                               const std::vector<std::string>& vocab,
                               const std::string& directory) {
    std::filesystem::create_directories(directory);

    // The weight file is intentionally named like a Transformer checkpoint, but
    // it remains a LibTorch archive. Python torch.load cannot read this file;
    // a Python <-> C++ converter is still required for that direction.
    torch::serialize::OutputArchive archive;
    model->save(archive);
    archive.save_to(join_path(directory, "pytorch_model.bin"));

    write_config_text(config, directory);
    write_config_json(config, directory, /*disguised=*/true);
    write_vocab(vocab, directory);

    std::ofstream tokenizer(join_path(directory, "tokenizer_config.json"));
    if (tokenizer) {
        tokenizer << "{\n";
        tokenizer << "  \"do_lower_case\": true,\n";
        tokenizer << "  \"unk_token\": \"<UNK>\",\n";
        tokenizer << "  \"sep_token\": \"<EOS>\",\n";
        tokenizer << "  \"pad_token\": \"<PAD>\",\n";
        tokenizer << "  \"cls_token\": \"<BOS>\",\n";
        tokenizer << "  \"mask_token\": \"<MASK>\",\n";
        tokenizer << "  \"tokenizer_class\": \"MemoriaTokenizer\"\n";
        tokenizer << "}\n";
    }
    std::cout << "disguised_checkpoint_saved: " << directory << std::endl;
}

CheckpointFormat detect_checkpoint_format(const std::string& directory) {
    if (file_exists(join_path(directory, "memoria_model.pt"))) {
        return CheckpointFormat::kMemoria;
    }
    const auto weight = join_path(directory, "pytorch_model.bin");
    if (!file_exists(weight)) {
        return CheckpointFormat::kUnknown;
    }
    const auto config_path = join_path(directory, "config.json");
    if (!file_exists(config_path)) {
        return CheckpointFormat::kUnknown;
    }
    auto raw = read_text_file(config_path);
    if (find_json_bool(raw, "_is_memoria_disguised") ||
        find_json_bool(raw, "_is_rga_disguised") ||
        raw.find("bert") != std::string::npos) {
        return CheckpointFormat::kDisguisedBert;
    }
    return CheckpointFormat::kUnknown;
}

MemoriaConfig read_checkpoint_config(const std::string& directory) {
    MemoriaConfig config;
    const auto text_path = join_path(directory, "memoria_config.txt");
    if (file_exists(text_path)) {
        std::ifstream in(text_path);
        std::string line;
        while (std::getline(in, line)) {
            if (line.empty() || line[0] == '#') continue;
            auto pos = line.find('=');
            if (pos == std::string::npos) continue;
            auto key = line.substr(0, pos);
            auto value = line.substr(pos + 1);
            if (key == "vocab_size") config.vocab_size = std::stoll(value);
            else if (key == "dim") config.dim = std::stoll(value);
            else if (key == "num_units") config.num_units = std::stoll(value);
            else if (key == "geo_depth") config.geo_depth = std::stoll(value);
            else if (key == "max_loop") config.max_loop = std::stoll(value);
            else if (key == "max_len") config.max_len = std::stoll(value);
            else if (key == "phase_threshold") config.phase_threshold = std::stod(value);
            else if (key == "v_scaling_factor") config.v_scaling_factor = std::stod(value);
            else if (key == "min_q_concepts") config.min_q_concepts = std::stod(value);
            else if (key == "history_length") config.history_length = std::stoll(value);
        }
        return config;
    }

    // Disguised directory: read the Transformer-shaped fields.
    const auto json_path = join_path(directory, "config.json");
    if (!file_exists(json_path)) {
        throw std::runtime_error("Memoria: no checkpoint config in " + directory);
    }
    auto raw = read_text_file(json_path);
    config.dim = static_cast<int64_t>(find_json_number(raw, "hidden_size", 32));
    config.num_units = static_cast<int64_t>(find_json_number(raw, "num_hidden_layers", 3));
    config.vocab_size = static_cast<int64_t>(find_json_number(raw, "vocab_size", 10000));
    config.max_len = static_cast<int64_t>(
        find_json_number(raw, "max_position_embeddings", 512));
    config.geo_depth = static_cast<int64_t>(find_json_number(raw, "geo_depth", 3));
    config.phase_threshold = find_json_number(raw, "phase_threshold", 0.8);
    return config;
}

std::vector<std::string> read_checkpoint_vocab(const std::string& directory) {
    std::ifstream in(join_path(directory, "vocab.txt"));
    if (!in) {
        throw std::runtime_error("Memoria: cannot read vocab.txt");
    }
    std::vector<std::string> vocab;
    std::string token;
    while (std::getline(in, token)) {
        if (!token.empty() && token.back() == '\r') {
            token.pop_back();
        }
        if (!token.empty()) {
            vocab.push_back(token);
        }
    }
    return vocab;
}

void load_checkpoint(MemoriaModel& model, const std::string& directory) {
    load_checkpoint(model, nullptr, directory, nullptr, nullptr);
}

void load_checkpoint(MemoriaModel& model,
                     torch::optim::Optimizer* optimizer,
                     const std::string& directory,
                     int64_t* next_epoch,
                     int64_t* global_step) {
    auto format = detect_checkpoint_format(directory);
    if (format == CheckpointFormat::kUnknown) {
        throw std::runtime_error("Memoria: unknown checkpoint format in " + directory);
    }

    const auto weight_path =
        format == CheckpointFormat::kDisguisedBert
            ? join_path(directory, "pytorch_model.bin")
            : join_path(directory, "memoria_model.pt");
    // Remember where the caller placed the model. The archive is deserialized
    // on CPU for portability, so restore the model to that device before
    // loading optimizer state; otherwise AdamW keeps CPU moments and fails on
    // the first CUDA step with a cuda/cpu device mismatch.
    const auto target_device = model->parameters()[0].device();
    torch::serialize::InputArchive archive;
    archive.load_from(weight_path, torch::kCPU);
    model->load(archive);
    model->to(target_device);
    std::cout << "checkpoint_loaded: " << directory
              << " format="
              << (format == CheckpointFormat::kDisguisedBert ? "disguised_bert"
                                                             : "memoria")
              << std::endl;

    if (optimizer != nullptr) {
        const auto optimizer_path = join_path(directory, "memoria_optimizer.pt");
        if (file_exists(optimizer_path)) {
            torch::serialize::InputArchive optimizer_archive;
            // Load optimizer state on the same device as the restored model.
            optimizer_archive.load_from(optimizer_path, target_device);
            optimizer->load(optimizer_archive);
            std::cout << "optimizer_loaded: " << optimizer_path << std::endl;
        }
    }

    const auto state_path = join_path(directory, "trainer_state.txt");
    if ((next_epoch != nullptr || global_step != nullptr) && file_exists(state_path)) {
        std::ifstream in(state_path);
        std::string line;
        while (std::getline(in, line)) {
            auto pos = line.find('=');
            if (pos == std::string::npos) continue;
            auto key = line.substr(0, pos);
            auto value = std::stoll(line.substr(pos + 1));
            if (key == "next_epoch" && next_epoch != nullptr) *next_epoch = value;
            if (key == "global_step" && global_step != nullptr) *global_step = value;
        }
    }
}

}  // namespace memoria
