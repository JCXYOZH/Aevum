# Memoria 设计

## 目标

用 C++/LibTorch 把“记忆中心”的语言模型链路跑通，先要工程闭环：能编译、能训练、能保存、能加载、能生成。算法有效性另做实验，不拿 loss 下降当唯一证据。

## 分层

```text
apps/                     桌面壳、监控、页面、中继：只负责调用与呈现
src/memoria/*.cpp         计算：嵌入、门控、链、平衡、记忆、训练、生成
src/memoria/memoria.h     统一入口；模块内源码只包含这一处
src/memoria/include/memoria/*.h       公共接口；每个模块一个头文件
scripts/                  构建、训练、生成、打包
data/                     公开小语料；权重不在这里
```

## 单周期链路

1. **Embedding**：词表 id -> 向量，带位置信息。
2. **Gated valve**：控制新信息写入的强度，避免每步全量覆盖。
3. **Chain unit × 3**：三路串联的循环单元，每路有自己的状态。
4. **Tri-balancer × 3**：在三层之间做权重平衡，输出融合权重。
5. **Strata memory**：按层保存记忆槽，读取时按权重取回。
6. **Weighted fusion + V regularization**：融合多路结果，并对 V 做正则。
7. **Output**：映射回词表，训练用交叉熵，生成用采样。

## 检查点

- 整模型：权重、优化器状态、下一 epoch、global step。
- 模块级：每个模块可以单独 `save/load`，用于排查某一层。
- 加载统一走 `torch::kCPU` 再按设备搬移；这是 CUDA 版在低内存机器上崩溃的修复点。
- 权重文件是 LibTorch archive，不是 Python pickle；不要用 `torch.load` 假装兼容。

## 训练

- 文本路径：UTF-8 一行一条，或 LCCC 风格 JSON 数组；按空格密度自动选 char/word，`--char` 可强制。
- 优化器：AdamW + 余弦退火 + 梯度裁剪；按 epoch 保存，`--load` 从下一 epoch 继续。
- 指标：`--metrics FILE` 写 JSONL（`start`、`step`、`epoch`、`done`）；看板只读真实文件，没有就不画。

## 设备

- CUDA 目标链接 `torch_cuda` / `c10_cuda`，并强制保留一个 `at::cuda` 符号，确保运行时真的加载 CUDA。
- CPU-only 目标不链接 CUDA 库，用 `cpu_cuda_stub.cpp` 提供 `c10::cuda::device_count()` 的返回值 0。
- `memoria_gen_cpu.exe` 是低内存机器上默认可跑的生成二进制。

## 明确不做

- 不在仓库里放大权重。
- 不把多个模块塞进一个文件。
- 不用页面伪造训练进度。
- 不把“能跑”说成“算法有效”。
