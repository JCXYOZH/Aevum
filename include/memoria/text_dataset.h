#pragma once

#include <torch/torch.h>

#include <cstdint>
#include <string>
#include <unordered_map>
#include <vector>

namespace memoria {

// One fixed-length language-modeling sample. input_ids and target_ids are
// [seq_length]; target_ids is input_ids shifted left by one, with PAD at the end.
struct TextSample {
    torch::Tensor input_ids;
    torch::Tensor target_ids;
};

struct TextDatasetOptions {
    int64_t seq_length = 128;      // Fixed sample width; targets are shifted.
    int64_t vocab_size = 15000;    // Includes the four special tokens.
    int64_t max_samples = 0;       // 0 means read every non-empty line.
    bool force_char_level = false; // true skips the whitespace heuristic.
};

// Reads UTF-8 text, one document/line per sample, builds a character or word
// vocabulary, then cuts each line into overlapping fixed-length segments.
//
// Ids: 0 <PAD>, 1 <UNK>, 2 <BOS>, 3 <EOS>, then vocabulary entries in
// frequency order. Text ids are target ids shifted left by one; the last target
// is 0 so the loss ignores the padding.
//
// This is the C++ counterpart of the Python SmartTextDataset text path. It
// accepts plain UTF-8 lines and LCCC-style JSON arrays of strings. HTML tags
// and braces are stripped. jieba word segmentation is not ported yet; word
// mode therefore follows whitespace only.
class TextDataset {
public:
    TextDataset(const std::string& path, TextDatasetOptions options = {});

    size_t size() const { return segments_.size(); }
    int64_t vocab_size() const { return static_cast<int64_t>(vocab_.size()); }
    bool use_char_level() const { return use_char_level_; }
    const std::vector<std::string>& vocab() const { return vocab_; }

    // Creates tensors for one segment. Throws if index is out of range.
    TextSample sample(size_t index) const;

    // Encodes arbitrary text with the dataset vocabulary. Generation usually
    // wants BOS at the start and no EOS; training segments add both.
    std::vector<int64_t> encode_text(const std::string& text,
                                     bool add_bos = false,
                                     bool add_eos = false) const;

    // Turns ids back into text for generation output. Special ids are skipped;
    // character mode concatenates, word mode joins with spaces.
    std::string decode_ids(const std::vector<int64_t>& ids) const;

    // Returns -1 when the token is not in the vocabulary.
    int64_t token_id(const std::string& token) const;

private:
    void load_texts(const std::string& path);
    void analyze_mode();
    void build_vocabulary();
    void encode_texts();
    void split_segments(const std::vector<int64_t>& encoded);
    void print_summary() const;

    // LCCC-style JSON: arrays of arrays of strings. The parser only extracts
    // string literals and ignores structure, which is enough for this corpus.
    static std::vector<std::string> parse_json_texts(const std::string& raw);
    // Removes simple HTML tags, braces/brackets/quotes and repeated spaces.
    static std::string clean_text(const std::string& text);

    // UTF-8 aware: a Chinese character is one token, not three bytes.
    static std::vector<std::string> utf8_codepoints(const std::string& text);
    static std::vector<std::string> split_words(const std::string& text);

    TextDatasetOptions options_;
    std::string path_;                        // Kept for the summary line.
    std::vector<std::string> texts_;          // One cleaned line per entry.
    std::vector<std::string> vocab_;          // id -> token.
    std::unordered_map<std::string, int64_t> token_to_id_;
    std::vector<std::vector<int64_t>> segments_;  // Encoded, padded id sequences.
    bool use_char_level_ = true;              // Decided in analyze_mode().
};

}  // namespace memoria
