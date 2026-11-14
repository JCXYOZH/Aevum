#pragma once

#include <torch/torch.h>

namespace memoria {

// Token embedding plus a fixed sinusoidal position encoding. The optional
// marker branch projects [Q, K, V] concept features into a marker vector; the
// main path does not consume markers, matching the Python baseline.
//
// The marker branch is vectorized: it gathers concept features for all tokens,
// runs the projection once, then selects projected or default rows. This is
// numerically equivalent to the reference per-token loop.
class EmbeddingLayerImpl : public torch::nn::Module {
public:
    struct Output {
        torch::Tensor base_embeddings;   // [batch, seq, dim]
        torch::Tensor markers;           // [batch, seq, marker_dim]
        torch::Tensor concept_features;  // [batch, seq, 3]
    };

    EmbeddingLayerImpl(int64_t vocab_size,
                       int64_t dim,
                       int64_t max_len = 512,
                       int64_t marker_dim = 32);

    // The main path uses only the base embeddings. The marker branch is kept
    // available for parity with the Python implementation.
    torch::Tensor forward(const torch::Tensor& input_ids);
    Output forward_with_markers(const torch::Tensor& input_ids);

    // indices: [n], features: [n, 3]. The buffers are not trainable.
    void set_concept_features(const torch::Tensor& word_indices,
                              const torch::Tensor& features);

private:
    // Fixed PE: pe[:, 0::2] = sin, pe[:, 1::2] = cos.
    torch::Tensor build_positional_encoding(int64_t max_len, int64_t dim) const;

    int64_t vocab_size_;
    int64_t dim_;
    int64_t max_len_;
    int64_t marker_dim_;

    torch::nn::Embedding token_embedding_{nullptr};
    torch::Tensor position_encoding_;  // [1, max_len, dim], buffer.

    torch::nn::Sequential marker_projection_{nullptr};  // 3 -> 16 -> marker_dim.
    torch::Tensor default_marker_;                      // [marker_dim], parameter.
    torch::Tensor concept_features_;                    // [vocab, 3], buffer.
    torch::Tensor has_concept_;                         // [vocab] bool, buffer.
};
TORCH_MODULE(EmbeddingLayer);

}  // namespace memoria
