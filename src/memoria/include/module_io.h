#pragma once

#include <string>

#include <torch/torch.h>

namespace memoria {

// Saves one module's parameters and buffers into its own archive. The caller
// supplies the path, so a checkpoint can be split into independently loadable
// pieces instead of one opaque model blob.
void save_module(const torch::nn::Module& module, const std::string& path);

// Loads the same module shape from an archive. This is intentionally strict:
// a shape or key mismatch throws, which is what a modular loader should do.
void load_module(torch::nn::Module& module, const std::string& path);

}  // namespace memoria
