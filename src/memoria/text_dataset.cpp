#include "memoria/text_dataset.h"

#include <algorithm>
#include <fstream>
#include <iostream>
#include <sstream>
#include <stdexcept>

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

}  // namespace

TextDataset::TextDataset(const std::string& path, TextDatasetOptions options)
    : options_(options), path_(path) {
    load_texts(path);
    analyze_mode();
    build_vocabulary();
    encode_texts();
    print_summary();
}

void TextDataset::load_texts(const std::string& path) {
    std::ifstream in(path, std::ios::binary);
    if (!in) {
        throw std::runtime_error("Memoria: cannot open text dataset: " + path);
    }

    std::ostringstream buffer;
    buffer << in.rdbuf();
    const std::string raw = buffer.str();
    if (raw.empty()) {
        throw std::runtime_error("Memoria: text dataset is empty: " + path);
    }

    std::vector<std::string> documents;
    const bool json_extension =
        path.size() >= 5 && path.substr(path.size() - 5) == ".json";
    const size_t first = raw.find_first_not_of(" \t\r\n");
    const bool json_content = first != std::string::npos && raw[first] == '[';
    if (json_extension || json_content) {
        documents = parse_json_texts(raw);
    } else {
        std::istringstream lines(raw);
        std::string line;
        while (std::getline(lines, line)) {
            documents.push_back(trim_cr(line));
        }
    }

    for (const auto& document : documents) {
        auto cleaned = clean_text(document);
        if (cleaned.empty()) {
            continue;
        }
        texts_.push_back(cleaned);
        if (options_.max_samples > 0 &&
            static_cast<int64_t>(texts_.size()) >= options_.max_samples) {
            break;
        }
    }
    if (texts_.empty()) {
        throw std::runtime_error("Memoria: text dataset has no usable text: " + path);
    }
}

std::vector<std::string> TextDataset::parse_json_texts(const std::string& raw) {
    // This is intentionally a string-literal scanner, not a full JSON parser.
    // LCCC is an array of arrays of strings, so every literal is a document.
    std::vector<std::string> out;
    for (size_t i = 0; i < raw.size(); ++i) {
        if (raw[i] != '"') continue;
        std::string text;
        ++i;
        for (; i < raw.size(); ++i) {
            const char c = raw[i];
            if (c == '"') break;
            if (c == '\\' && i + 1 < raw.size()) {
                const char esc = raw[++i];
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
                        if (i + 4 < raw.size()) {
                            uint32_t cp = 0;
                            for (int k = 1; k <= 4; ++k) {
                                cp = (cp << 4) | hex_value(raw[i + k]);
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
        if (!text.empty()) {
            out.push_back(text);
        }
    }
    return out;
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
        if (c == ' ' || c == '\t' || c == '\n' || c == '\r') {
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

void TextDataset::analyze_mode() {
    if (options_.force_char_level) {
        use_char_level_ = true;
        return;
    }

    // The Python reference chooses word mode only when spaces are common.
    // Chinese text without spaces therefore falls back to character mode.
    size_t sample_count = std::min<size_t>(1000, texts_.size());
    size_t chars = 0;
    size_t spaces = 0;
    for (size_t i = 0; i < sample_count; ++i) {
        chars += texts_[i].size();
        spaces += static_cast<size_t>(
            std::count(texts_[i].begin(), texts_[i].end(), ' '));
    }
    const double space_ratio =
        chars == 0 ? 0.0 : static_cast<double>(spaces) / static_cast<double>(chars);
    use_char_level_ = space_ratio <= 0.1;
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

void TextDataset::build_vocabulary() {
    vocab_.clear();
    vocab_.push_back("<PAD>");
    vocab_.push_back("<UNK>");
    vocab_.push_back("<BOS>");
    vocab_.push_back("<EOS>");

    std::unordered_map<std::string, int64_t> counts;
    if (use_char_level_) {
        for (const auto& text : texts_) {
            for (const auto& ch : utf8_codepoints(text)) {
                if (ch != " ") {
                    counts[ch] += 1;
                }
            }
        }
    } else {
        for (const auto& text : texts_) {
            for (const auto& word : split_words(text)) {
                counts[word] += 1;
            }
        }
    }

    // Frequency first, then lexical order for deterministic vocab files.
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

    for (size_t i = 0; i < vocab_.size(); ++i) {
        token_to_id_[vocab_[i]] = static_cast<int64_t>(i);
    }
}

void TextDataset::encode_texts() {
    // Training samples are half-overlapping, matching the Python splitter.
    const int64_t step_size = std::max<int64_t>(1, options_.seq_length / 2);
    const int64_t min_valid = std::max<int64_t>(5, options_.seq_length / 4);

    for (const auto& text : texts_) {
        std::vector<int64_t> encoded;
        encoded.push_back(kBosId);

        if (use_char_level_) {
            for (const auto& ch : utf8_codepoints(text)) {
                if (ch == " ") {
                    continue;
                }
                auto it = token_to_id_.find(ch);
                encoded.push_back(it == token_to_id_.end() ? kUnkId : it->second);
            }
        } else {
            for (const auto& word : split_words(text)) {
                auto it = token_to_id_.find(word);
                encoded.push_back(it == token_to_id_.end() ? kUnkId : it->second);
            }
        }
        encoded.push_back(kEosId);

        for (size_t i = 0; i < encoded.size(); i += static_cast<size_t>(step_size)) {
            std::vector<int64_t> segment;
            segment.reserve(static_cast<size_t>(options_.seq_length));
            for (size_t j = i;
                 j < encoded.size() && segment.size() < static_cast<size_t>(options_.seq_length);
                 ++j) {
                segment.push_back(encoded[j]);
            }

            int64_t valid = 0;
            for (auto id : segment) {
                if (id != kPadId) ++valid;
            }
            if (valid < min_valid) {
                continue;
            }
            while (static_cast<int64_t>(segment.size()) < options_.seq_length) {
                segment.push_back(kPadId);
            }
            segments_.push_back(std::move(segment));
        }
    }
}

TextSample TextDataset::sample(size_t index) const {
    if (index >= segments_.size()) {
        throw std::out_of_range("Memoria: text sample index out of range");
    }
    auto input = torch::tensor(segments_[index], torch::kLong);
    // Next-token target: shift left by one and pad the last position with 0.
    auto target = torch::cat(
        {input.narrow(0, 1, input.size(0) - 1),
         torch::zeros({1}, torch::kLong)});
    return {input, target};
}

int64_t TextDataset::token_id(const std::string& token) const {
    auto it = token_to_id_.find(token);
    return it == token_to_id_.end() ? -1 : it->second;
}

std::vector<int64_t> TextDataset::encode_text(const std::string& text,
                                              bool add_bos,
                                              bool add_eos) const {
    std::vector<int64_t> ids;
    if (add_bos) {
        ids.push_back(kBosId);
    }
    if (use_char_level_) {
        for (const auto& ch : utf8_codepoints(text)) {
            if (ch == " ") {
                continue;
            }
            auto it = token_to_id_.find(ch);
            ids.push_back(it == token_to_id_.end() ? kUnkId : it->second);
        }
    } else {
        for (const auto& word : split_words(text)) {
            auto it = token_to_id_.find(word);
            ids.push_back(it == token_to_id_.end() ? kUnkId : it->second);
        }
    }
    if (add_eos) {
        ids.push_back(kEosId);
    }
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

void TextDataset::print_summary() const {
    std::cout << "text_dataset: path=" << path_
              << " texts=" << texts_.size()
              << " mode=" << (use_char_level_ ? "char" : "word")
              << " vocab=" << vocab_.size()
              << " segments=" << segments_.size()
              << " seq=" << options_.seq_length << std::endl;
}

}  // namespace memoria
