# Memoria

Memoria 是 Aevum 里负责“记忆方向”的模块，现在已经不只是空骨架：`src/memoria/` 是 C++（LibTorch）实现，`src/memoria/include/` 是公共头文件目录，统一入口是 `src/memoria/include/aevum_core.h`。模块内外都写 `#include <include/aevum_core.h>`，构建提供 `-I src/memoria`；同目录内部依赖用 `"..."`。

## 它是什么

默认的单周期前向链路：

```text
embedding
  -> gated valve        门控写入
  -> chain unit × 3     三路循环
  -> tri-balancer × 3   三层平衡
  -> strata memory      分层记忆
  -> weighted fusion    加权融合
  -> V regularization   V 正则
  -> output             输出
```

每个模块都有自己的头文件、实现和保存/加载入口；模块之间只依赖更低层，不把实现塞进一个文件。

## 代码位置

| 路径 | 内容 |
| --- | --- |
| `src/memoria/model.cpp` | 整条前向链的装配 |
| `src/memoria/embedding_layer.cpp` | token 到向量 |
| `src/memoria/gated_valve.cpp` | 门控写入 |
| `src/memoria/chain_unit.cpp` | 循环单元 |
| `src/memoria/tri_balancer.cpp` | 三层平衡 |
| `src/memoria/strata_memory.cpp` | 分层记忆 |
| `src/memoria/module_io.cpp` | 模块级保存/加载 |
| `src/memoria/checkpoint.cpp` | 整模型与优化器检查点 |
| `src/memoria/trainer.cpp` | 文本训练、AdamW、余弦退火、指标 |
| `src/memoria/generator.cpp` | 采样生成 |
| `src/memoria/main.cpp` | 训练入口 |
| `src/memoria/chat_main.cpp` | 生成入口 |
| `src/memoria/text_dataset.cpp` | UTF-8 文本/JSON 语料与词表 |
| `src/memoria/cpu_cuda_stub.cpp` | CPU-only 目标用的 CUDA 符号桩 |

## 与 Python 骨架的关系

`src/memoria/` 下还保留着早期 Python 包的空目录（`core/`、`layers/`、`trainers/` 等），那是接口职责占位，当前不参与 C++ 构建。真正的可编译实现是 `src/memoria/*.cpp` 与 `src/memoria/include/*.h`。不要把空 Python 文件误当成已实现模块。

## 权重边界

- 代码开源，**大模型文件不进 Git**。
- `.pt`、`.safetensors`、`checkpoint*/`、`build/` 已被 `.gitignore` 排除。
- 要发布权重，走 Release 附件、对象存储或服务器下载；仓库里只留下载说明和校验值。

## 构建与运行

见 [usage](usage.md)。
