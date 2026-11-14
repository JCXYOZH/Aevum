#include "memoria.h"

#include <stdexcept>

namespace memoria {

void save_module(const torch::nn::Module& module, const std::string& path) {
    torch::serialize::OutputArchive archive;
    module.save(archive);
    archive.save_to(path);
}

void load_module(torch::nn::Module& module, const std::string& path) {
    torch::serialize::InputArchive archive;
    archive.load_from(path);
    module.load(archive);
}

}  // namespace memoria
