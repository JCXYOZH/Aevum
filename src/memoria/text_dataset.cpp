#include "include/memoria/text_dataset.h"

#include <algorithm>
#include <cctype>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <utility>

namespace memoria {

namespace {

constexpr int64_t kPadId = 0;
constexpr int64_t kUnkId = 1;
constexpr int64_t kBosId = 2;
constexpr int64_t kEosId = 3;

std::string trim_cr(const std::string& line) {
    if (!line.empty() && line.back() == '\r') {
        return line.substr(0, line.size() - 1);
    }
    return line;
}

// Appends one Unicode code point as UTF-8. Used by the JSON \u escape path.
void append_utf8(std::string& out, uint32_t code_point) {
    if (code_point <= 0x7F) {
        out.push_back(static_cast<char>(code_point));
    } else if (code_point <= 0x7FF) {
        out.push_back(static_cast<char>(0xC0 | (code_point >> 6)));
        out.push_back(static_cast<char>(0x80 | (code_point & 0x3F)));
    } else if (code_point <= 0xFFFF) {
        out.push_back(static_cast<char>(0xE0 | (code_point >> 12)));
        out.push_back(static_cast<char>(0x80 | ((code_point >> 6) & 0x3F)));
        out.push_back(static_cast<char>(0x80 | (code_point & 0x3F)));
    } else {
        out.push_back(static_cast<char>(0xF0 | (code_point >> 18)));
        out.push_back(static_cast<char>(0x80 | ((code_point >> 12) & 0x3F)));
        out.push_back(static_cast<char>(0x80 | ((code_point >> 6) & 0x3F)));
        out.push_back(static_cast<char>(0x80 | (code_point & 0x3F)));
    }
}

uint32_t hex_value(char c) {
    if (c >= '0' && c <= '9') return static_cast<uint32_t>(c - '0');
    if (c >= 'a' && c <= 'f') return static_cast<uint32_t>(c - 'a' + 10);
    if (c >= 'A' && c <= 'F') return static_cast<uint32_t>(c - 'A' + 10);
    return 0;
}

bool is_space(char c) {
    return c == ' ' || c == '\t' || c == '\n' || c == '\r';
}

}  // namespace

TextDataset::TextDataset(const std::string& path, TextDatasetOptions options) {
    initialize({path}, std::move(options));
}

TextDataset::TextDataset(const std::vector<std::string>& paths,
                         TextDatasetOptions options) {
    initialize(paths, std::move(options));
}

void TextDataset::initialize(const std::vector<std::string>& paths,
                             TextDatasetOptions options) {
    if (paths.empty()) {
        throw std::runtime_error("Memoria: text dataset has no paths");
    }
    options_ = std::move(options);
    if (options_.seq_length <= 0) {
        throw std::runtime_error("Memoria: seq_length must be positive");
    }
    if (options_.vocab_size < 4) {
        throw std::runtime_error("Memoria: vocab_size must be at least 4");
    }

    paths_.clear();
    for (const auto& path : paths) {
        if (path.empty()) continue;
        if (!std::filesystem::exists(path)) {
            throw std::runtime_error("Memoria: cannot open text dataset: " + path);
        }
        paths_.push_back(path);
    }
    if (paths_.empty()) {
        throw std::runtime_error("Memoria: text dataset has no usable paths");
    }
    path_ = paths_.front();
    streams_.resize(paths_.size());

    decide_mode();
    build_index();
    load_or_build_vocabulary();
    print_summary();
}

void TextDataset::decide_mode() {
    use_char_level_ = true;
    if (options_.force_char_level) {
        return;
    }

    // Sample the first shard instead of scanning the full corpus. CCI3-HQ is
    // Chinese and has almost no spaces, so this selects character mode there.
    std::ifstream in(path_, std::ios::binary);
    if (!in) {
        return;
    }
    std::string sample;
    sample.reserve(64 * 1024);
    char c = 0;
    for (int64_t i = 0; i < 64 * 1024 && in.get(c); ++i) {
        sample.push_back(c);
    }
    size_t chars = 0;
    size_t spaces = 0;
    for (char ch : sample) {
        if (!is_space(ch)) ++chars;
        if (ch == ' ') ++spaces;
    }
    if (chars == 0) {
        return;
    }
    const double space_ratio =
        static_cast<double>(spaces) / static_cast<double>(chars);
    use_char_level_ = space_ratio <= 0.1;
}

void TextDataset::build_index() {
    documents_.clear();
    segment_prefix_.clear();
    segment_prefix_.push_back(0);
    total_segments_ = 0;

    bool reached_limit = false;
    for (size_t file_index = 0; file_index < paths_.size() && !reached_limit;
         ++file_index) {
        std::ifstream in(paths_[file_index], std::ios::binary);
        if (!in) {
            throw std::runtime_error(
                "Memoria: cannot open text dataset: " + paths_[file_index]);
        }

        std::string line;
        while (true) {
            const std::streampos position = in.tellg();
            if (position == std::streampos(-1)) {
                break;
            }
            if (!std::getline(in, line)) {
                break;
            }
            const uint64_t line_offset =
                static_cast<uint64_t>(position);

            line = trim_cr(line);
            if (line.empty()) continue;
            auto cleaned = clean_text(extract_document_text(line));
            if (cleaned.empty()) continue;

            const int64_t token_count = count_tokens(cleaned);
            const int64_t segment_count = segment_count_for(token_count);
            if (segment_count <= 0) continue;

            Document document;
            document.file_index = static_cast<uint32_t>(file_index);
            document.byte_offset = line_offset;
            document.segment_start = total_segments_;
            document.segment_count = static_cast<uint64_t>(segment_count);
            documents_.push_back(document);

            total_segments_ += static_cast<uint64_t>(segment_count);
            segment_prefix_.push_back(total_segments_);

            if (options_.max_samples > 0 &&
                static_cast<int64_t>(documents_.size()) >= options_.max_samples) {
                reached_limit = true;
                break;
            }
        }
    }

    if (documents_.empty() || total_segments_ == 0) {
        throw std::runtime_error(
            "Memoria: text dataset has no usable text: " + path_);
    }
}

std::string TextDataset::extract_document_text(const std::string& line) {
    const auto first = line.find_first_not_of(" \t\r\n");
    if (first == std::string::npos || line[first] != '{') {
        return line;
    }

    const auto key_pos = line.find("\"text\"", first);
    if (key_pos == std::string::npos) {
        return line;
    }
    auto colon = line.find(':', key_pos + 6);
    if (colon == std::string::npos) {
        return line;
    }
    auto quote = line.find('"', colon + 1);
    if (quote == std::string::npos) {
        return line;
    }

    std::string text;
    text.reserve(line.size() / 2);
    for (size_t i = quote + 1; i < line.size(); ++i) {
        const char c = line[i];
        if (c == '"') break;
        if (c == '\\' && i + 1 < line.size()) {
            const char esc = line[++i];
            switch (esc) {
                case 'n': text.push_back('\n'); break;
                case 'r': text.push_back('\r'); break;
                case 't': text.push_back('\t'); break;
                case 'b': text.push_back('\b'); break;
                case 'f': text.push_back('\f'); break;
                case '"': text.push_back('"'); break;
                case '\\': text.push_back('\\'); break;
                case '/': text.push_back('/'); break;
                case 'u': {
                    if (i + 4 < line.size()) {
                        uint32_t cp = 0;
                        for (int k = 1; k <= 4; ++k) {
                            cp = (cp << 4) | hex_value(line[i + k]);
                        }
                        i += 4;
                        append_utf8(text, cp);
                    }
                    break;
                }
                default: text.push_back(esc); break;
            }
        } else {
            text.push_back(c);
        }
    }
    return text;
}

std::string TextDataset::clean_text(const std::string& text) {
    std::string out;
    bool in_tag = false;
    bool pending_space = false;
    for (char c : text) {
        if (c == '<') {
            in_tag = true;
            continue;
        }
        if (c == '>' && in_tag) {
            in_tag = false;
            continue;
        }
        if (in_tag) continue;
        if (c == '{' || c == '}' || c == '[' || c == ']' || c == '"') {
            continue;
        }
        if (is_space(c)) {
            pending_space = !out.empty();
            continue;
        }
        if (pending_space) {
            out.push_back(' ');
            pending_space = false;
        }
        out.push_back(c);
    }
    return out;
}

std::vector<std::string> TextDataset::utf8_codepoints(const std::string& text) {
    std::vector<std::string> out;
    out.reserve(text.size());
    for (size_t i = 0; i < text.size();) {
        const unsigned char c = static_cast<unsigned char>(text[i]);
        size_t len = 1;
        if ((c & 0x80) == 0) {
            len = 1;
        } else if ((c & 0xE0) == 0xC0) {
            len = 2;
        } else if ((c & 0xF0) == 0xE0) {
            len = 3;
        } else if ((c & 0xF8) == 0xF0) {
            len = 4;
        }
        if (i + len > text.size()) {
            len = 1;  // Truncated sequence: keep the byte and map it to UNK.
        }
        out.push_back(text.substr(i, len));
        i += len;
    }
    return out;
}

std::vector<std::string> TextDataset::split_words(const std::string& text) {
    std::vector<std::string> out;
    std::istringstream stream(text);
    std::string word;
    while (stream >> word) {
        out.push_back(word);
    }
    return out;
}

int64_t TextDataset::count_tokens(const std::string& cleaned_text) const {
    int64_t count = 0;
    if (use_char_level_) {
        for (const auto& ch : utf8_codepoints(cleaned_text)) {
            if (ch != " ") ++count;
        }
    } else {
        count = static_cast<int64_t>(split_words(cleaned_text).size());
    }
    return count + 2;  // BOS and EOS
}

int64_t TextDataset::segment_count_for(int64_t token_count) const {
    const int64_t step_size = std::max<int64_t>(1, options_.seq_length / 2);
    const int64_t min_valid = std::max<int64_t>(5, options_.seq_length / 4);
    if (token_count < min_valid) {
        return 0;
    }
    return (token_count - min_valid) / step_size + 1;
}

std::string TextDataset::read_document(const Document& document,
                                       std::size_t file_index) const {
    if (file_index >= streams_.size()) {
        throw std::out_of_range("Memoria: document file index out of range");
    }
    if (!streams_[file_index]) {
        streams_[file_index] =
            std::make_unique<std::ifstream>(paths_[file_index], std::ios::binary);
        if (!*streams_[file_index]) {
            throw std::runtime_error(
                "Memoria: cannot open text dataset: " + paths_[file_index]);
        }
    }
    auto& stream = *streams_[file_index];
    stream.clear();
    stream.seekg(static_cast<std::streamoff>(document.byte_offset));
    if (!stream) {
        throw std::runtime_error(
            "Memoria: cannot seek text dataset: " + paths_[file_index]);
    }
    std::string line;
    if (!std::getline(stream, line)) {
        throw std::runtime_error(
            "Memoria: cannot read document at offset " +
            std::to_string(document.byte_offset));
    }
    return trim_cr(line);
}

void TextDataset::load_or_build_vocabulary() {
    vocab_.clear();
    token_to_id_.clear();

    const std::string vocab_path = resolve_vocab_path();
    if (!vocab_path.empty() && std::filesystem::exists(vocab_path)) {
        load_vocabulary_file(vocab_path);
        return;
    }

    build_vocabulary_from_sample();
    if (!vocab_path.empty()) {
        save_vocabulary_file(vocab_path);
    }
}

std::string TextDataset::resolve_vocab_path() const {
    if (!options_.vocab_path.empty()) {
        return options_.vocab_path;
    }
    if (paths_.empty()) {
        return {};
    }
    return (std::filesystem::path(paths_.front()).parent_path() / "vocab.txt").string();
}

void TextDataset::load_vocabulary_file(const std::string& path) {
    std::ifstream in(path, std::ios::binary);
    if (!in) {
        throw std::runtime_error("Memoria: cannot read vocab file: " + path);
    }
    std::string token;
    while (std::getline(in, token)) {
        token = trim_cr(token);
        if (!token.empty()) {
            vocab_.push_back(token);
        }
    }
    if (vocab_.size() < 4) {
        throw std::runtime_error("Memoria: vocab file has fewer than 4 entries: " + path);
    }
    for (size_t i = 0; i < vocab_.size(); ++i) {
        token_to_id_[vocab_[i]] = static_cast<int64_t>(i);
    }
}

void TextDataset::save_vocabulary_file(const std::string& path) const {
    if (path.empty()) return;
    const auto parent = std::filesystem::path(path).parent_path();
    if (!parent.empty()) {
        std::filesystem::create_directories(parent);
    }
    std::ofstream out(path, std::ios::binary);
    if (!out) {
        throw std::runtime_error("Memoria: cannot write vocab file: " + path);
    }
    for (const auto& token : vocab_) {
        out << token << '\n';
    }
}

void TextDataset::build_vocabulary_from_sample() {
    std::unordered_map<std::string, int64_t> counts;
    int64_t bytes_read = 0;
    const int64_t limit = std::max<int64_t>(1LL * 1024 * 1024,
                                             options_.vocab_sample_bytes);

    for (const auto& path : paths_) {
        if (bytes_read >= limit) break;
        std::ifstream in(path, std::ios::binary);
        if (!in) {
            throw std::runtime_error("Memoria: cannot open text dataset: " + path);
        }
        std::string line;
        while (std::getline(in, line)) {
            bytes_read += static_cast<int64_t>(line.size()) + 1;
            if (bytes_read > limit) break;
            line = trim_cr(line);
            if (line.empty()) continue;
            auto cleaned = clean_text(extract_document_text(line));
            if (cleaned.empty()) continue;
            if (use_char_level_) {
                for (const auto& ch : utf8_codepoints(cleaned)) {
                    if (ch != " ") counts[ch] += 1;
                }
            } else {
                for (const auto& word : split_words(cleaned)) {
                    counts[word] += 1;
                }
            }
        }
    }

    vocab_.push_back("<PAD>");
    vocab_.push_back("<UNK>");
    vocab_.push_back("<BOS>");
    vocab_.push_back("<EOS>");

    std::vector<std::pair<std::string, int64_t>> ordered;
    ordered.reserve(counts.size());
    for (const auto& item : counts) {
        ordered.push_back(item);
    }
    std::sort(ordered.begin(), ordered.end(),
              [](const auto& a, const auto& b) {
                  if (a.second != b.second) return a.second > b.second;
                  return a.first < b.first;
              });

    for (const auto& item : ordered) {
        if (static_cast<int64_t>(vocab_.size()) >= options_.vocab_size) {
            break;
        }
        vocab_.push_back(item.first);
    }

    if (vocab_.size() <= 4) {
        throw std::runtime_error("Memoria: no vocabulary could be built from data");
    }
    for (size_t i = 0; i < vocab_.size(); ++i) {
        token_to_id_[vocab_[i]] = static_cast<int64_t>(i);
    }
}

TextSample TextDataset::sample(size_t index) const {
    if (index >= total_segments_) {
        throw std::out_of_range("Memoria: text sample index out of range");
    }

    const auto it = std::upper_bound(segment_prefix_.begin(),
                                     segment_prefix_.end(),
                                     static_cast<uint64_t>(index));
    const size_t document_index =
        static_cast<size_t>(it - segment_prefix_.begin()) - 1;
    const Document& document = documents_[document_index];
    const uint64_t segment_index =
        static_cast<uint64_t>(index) - document.segment_start;

    const std::string raw = read_document(document, document.file_index);
    auto cleaned = clean_text(extract_document_text(raw));
    const std::vector<int64_t> encoded = encode_text(cleaned, true, true);

    const int64_t step_size = std::max<int64_t>(1, options_.seq_length / 2);
    const size_t start = static_cast<size_t>(segment_index) *
                         static_cast<size_t>(step_size);

    std::vector<int64_t> segment;
    segment.reserve(static_cast<size_t>(options_.seq_length));
    for (size_t i = start;
         i < encoded.size() &&
         segment.size() < static_cast<size_t>(options_.seq_length);
         ++i) {
        segment.push_back(encoded[i]);
    }
    while (static_cast<int64_t>(segment.size()) < options_.seq_length) {
        segment.push_back(kPadId);
    }

    auto input = torch::tensor(segment, torch::kLong);
    auto target = torch::cat(
        {input.narrow(0, 1, input.size(0) - 1),
         torch::zeros({1}, torch::kLong)});
    return {input, target};
}

std::vector<int64_t> TextDataset::encode_text(const std::string& text,
                                             bool add_bos,
                                             bool add_eos) const {
    std::vector<int64_t> ids;
    if (add_bos) ids.push_back(kBosId);
    if (use_char_level_) {
        for (const auto& ch : utf8_codepoints(text)) {
            if (ch == " ") continue;
            auto it = token_to_id_.find(ch);
            ids.push_back(it == token_to_id_.end() ? kUnkId : it->second);
        }
    } else {
        for (const auto& word : split_words(text)) {
            auto it = token_to_id_.find(word);
            ids.push_back(it == token_to_id_.end() ? kUnkId : it->second);
        }
    }
    if (add_eos) ids.push_back(kEosId);
    return ids;
}

std::string TextDataset::decode_ids(const std::vector<int64_t>& ids) const {
    std::string out;
    for (auto id : ids) {
        // PAD, BOS and EOS are structural markers, not visible text.
        if (id == kPadId || id == kBosId || id == kEosId) {
            continue;
        }
        if (id == kUnkId) {
            out += "<UNK>";
            continue;
        }
        if (id < 0 || id >= static_cast<int64_t>(vocab_.size())) {
            continue;
        }
        if (!use_char_level_ && !out.empty()) {
            out += " ";
        }
        out += vocab_[static_cast<size_t>(id)];
    }
    return out;
}

int64_t TextDataset::token_id(const std::string& token) const {
    auto it = token_to_id_.find(token);
    return it == token_to_id_.end() ? -1 : it->second;
}

void TextDataset::print_summary() const {
    std::cout << "text_dataset: path=" << path_
              << " files=" << paths_.size()
              << " docs=" << documents_.size()
              << " mode=" << (use_char_level_ ? "char" : "word")
              << " vocab=" << vocab_.size()
              << " segments=" << total_segments_
              << " seq=" << options_.seq_length << std::endl;
}

}  // namespace memoria
