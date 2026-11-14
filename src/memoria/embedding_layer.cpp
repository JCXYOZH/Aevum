#include <include/aevum_core.h>

#include <cmath>
#include <stdexcept>

namespace memoria {

EmbeddingLayerImpl::EmbeddingLayerImpl(int64_t vocab_size,
                                      int64_t dim,
                                      int64_t max_len,
                                      int64_t marker_dim)
    : vocab_size_(vocab_size),
      dim_(dim),
      max_len_(max_len),
      marker_dim_(marker_dim) {
    token_embedding_ = register_module("token_embedding", torch::nn::Embedding(vocab_size, dim));
    position_encoding_ = register_buffer(
        "position_encoding", build_positional_encoding(max_len, dim));

    marker_projection_ = register_module(
        "marker_projection",
        torch::nn::Sequential(
            torch::nn::Linear(3, 16),
            torch::nn::ReLU(),
            torch::nn::Linear(16, marker_dim),
            torch::nn::Tanh()));
    default_marker_ = register_parameter(
        "default_marker", torch::randn({marker_dim}) * 0.1);
    concept_features_ = register_buffer(
        "concept_features", torch::zeros({vocab_size, 3}));
    has_concept_ = register_buffer(
        "has_concept", torch::zeros({vocab_size}, torch::kBool));
}

torch::Tensor EmbeddingLayerImpl::build_positional_encoding(int64_t max_len,
                                                            int64_t dim) const {
    // Standard sinusoidal table. Frequencies are exponentially spaced, and
    // even indices use sine while odd indices use cosine.
    auto position = torch::arange(max_len, torch::kFloat32).unsqueeze(1);
    auto div_term = torch::exp(
        torch::arange(0, dim, 2, torch::kFloat32) *
        (-std::log(10000.0) / static_cast<double>(dim)));
    auto pe = torch::zeros({max_len, dim});
    for (int64_t i = 0; i < div_term.size(0); ++i) {
        auto wave = position.squeeze(1) * div_term.select(0, i);
        pe.index_put_({torch::indexing::Slice(), i * 2}, torch::sin(wave));
        if (i * 2 + 1 < dim) {
            pe.index_put_({torch::indexing::Slice(), i * 2 + 1}, torch::cos(wave));
        }
    }
    return pe.unsqueeze(0);
}

torch::Tensor EmbeddingLayerImpl::forward(const torch::Tensor& input_ids) {
    return forward_with_markers(input_ids).base_embeddings;
}

EmbeddingLayerImpl::Output EmbeddingLayerImpl::forward_with_markers(
    const torch::Tensor& input_ids) {
    auto batch = input_ids.size(0);
    auto seq = input_ids.size(1);
    auto token_emb = token_embedding_->forward(input_ids);
    auto pos_emb = seq <= max_len_
                       ? position_encoding_.narrow(1, 0, seq)
                       : build_positional_encoding(seq, dim_);
    auto base_embeddings = token_emb + pos_emb;

    // Vectorized equivalent of the reference per-token loop: project real
    // concept features once, then choose them where has_concept is true.
    auto flat_ids = input_ids.reshape({-1});
    auto flat_features = concept_features_.index_select(0, flat_ids);
    auto flat_has_concept = has_concept_.index_select(0, flat_ids).to(torch::kBool);
    auto projected = marker_projection_->forward(flat_features);
    auto fallback = default_marker_.unsqueeze(0).expand({flat_ids.size(0), marker_dim_});
    auto markers_flat = torch::where(flat_has_concept.unsqueeze(1), projected, fallback);

    return {
        base_embeddings,
        markers_flat.reshape({batch, seq, marker_dim_}),
        flat_features.reshape({batch, seq, 3}),
    };
}

void EmbeddingLayerImpl::set_concept_features(const torch::Tensor& word_indices,
                                              const torch::Tensor& features) {
    if (word_indices.numel() != features.size(0)) {
        throw std::runtime_error("Memoria: concept features count mismatch");
    }
    torch::NoGradGuard guard;
    auto indices = word_indices.to(torch::kLong).to(concept_features_.device());
    concept_features_.index_copy_(0, indices, features.to(concept_features_.device()));
    has_concept_.index_fill_(0, indices, true);
}

}  // namespace memoria
