#pragma once

#include <torch/torch.h>

#include <cstdint>
#include <fstream>
#include <memory>
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
    int64_t max_samples = 0;       // 0 means read every non-empty document.
    int64_t vocab_sample_bytes = 256LL * 1024 * 1024;  // Bytes used to build a vocab.
    bool force_char_level = false; // true skips the whitespace heuristic.
    std::string vocab_path;        // Optional fixed vocab.txt for multi-shard runs.
};

// Reads one or more UTF-8 files without loading the whole corpus into memory.
// Plain text is one document per line; CCI3-HQ-style JSONL is one object per
// line and its "text" field is used. A document index (file + byte offset +
// segment count) is kept in memory, while document text is read on demand.
//
// This replaces the old whole-file loader so a 58 GB corpus can be trained one
// shard at a time with a fixed vocabulary. The four special ids are:
// 0 <PAD>, 1 <UNK>, 2 <BOS>, 3 <EOS>.
class TextDataset {
public:
    TextDataset(const std::string& path, TextDatasetOptions options = {});
    TextDataset(const std::vector<std::string>& paths,
                TextDatasetOptions options = {});

    size_t size() const { return total_segments_; }
    int64_t vocab_size() const { return static_cast<int64_t>(vocab_.size()); }
    bool use_char_level() const { return use_char_level_; }
    const std::vector<std::string>& vocab() const { return vocab_; }
    const std::vector<std::string>& paths() const { return paths_; }

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
    struct Document {
        uint32_t file_index = 0;
        uint64_t byte_offset = 0;
        uint64_t segment_start = 0;
        uint64_t segment_count = 0;
    };

    void initialize(const std::vector<std::string>& paths, TextDatasetOptions options);
    void decide_mode();
    void build_index();
    void load_or_build_vocabulary();
    void build_vocabulary_from_sample();
    void load_vocabulary_file(const std::string& path);
    void save_vocabulary_file(const std::string& path) const;
    std::string resolve_vocab_path() const;

    // Extracts the value of a JSON "text" field from one line. If the line is
    // not an object, the whole line is treated as plain text.
    static std::string extract_document_text(const std::string& line);
    // Removes simple HTML tags, braces/brackets/quotes and repeated spaces.
    static std::string clean_text(const std::string& text);
    // UTF-8 aware: a Chinese character is one token, not three bytes.
    static std::vector<std::string> utf8_codepoints(const std::string& text);
    static std::vector<std::string> split_words(const std::string& text);
    int64_t count_tokens(const std::string& cleaned_text) const;
    int64_t segment_count_for(int64_t token_count) const;
    std::string read_document(const Document& document, std::size_t file_index) const;
    void print_summary() const;

    TextDatasetOptions options_;
    std::string path_;                        // Kept for the summary line.
    std::vector<std::string> paths_;
    std::vector<Document> documents_;
    std::vector<uint64_t> segment_prefix_;    // documents_.size() + 1 entries.
    uint64_t total_segments_ = 0;

    std::vector<std::string> vocab_;          // id -> token.
    std::unordered_map<std::string, int64_t> token_to_id_;
    bool use_char_level_ = true;              // Decided in decide_mode().

    // One lazily opened stream per shard. TextDataset is used from the single
    // training thread; sample() is const so the streams are mutable.
    mutable std::vector<std::unique_ptr<std::ifstream>> streams_;
};

}  // namespace memoria
