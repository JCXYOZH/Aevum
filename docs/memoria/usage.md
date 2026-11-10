# Memoria 使用

## 依赖

Windows：

- Visual Studio 2022 Build Tools（C++ 工作负载）
- Windows SDK 10
- 带 LibTorch 头与库的 PyTorch wheel；`MEMORIA_TORCH_DIR` 指向 `site-packages/torch`

Linux：

- C++17 编译器（`g++`）
- PyTorch wheel；`MEMORIA_TORCH_ROOT` 指向包含 `include/` 与 `lib/` 的目录
- `python3`（不设 `MEMORIA_TORCH_ROOT` 时用它推导）

## 编译

Windows：

```powershell
scripts\build.ps1
```

机器路径可用参数或环境变量覆盖：

- `MEMORIA_TORCH_DIR`
- `MEMORIA_VCVARS`
- `MEMORIA_SDK_DIR`
- `MEMORIA_SDK_VERSION`

Linux：

```bash
bash scripts/build-linux.sh
MEMORIA_TORCH_ROOT=/opt/libtorch bash scripts/build-linux.sh --clean
```

输出：

```text
build/memoria_train.exe
build/memoria_gen.exe
build/memoria_gen_cpu.exe
```

Linux 输出在 `build/linux/`。`memoria_gen_cpu` 不链接 CUDA，适合低内存机器。

## 训练

```powershell
scripts\train.ps1 -Epochs 4 -Batch 32 -SeqLen 16 -Vocab 3000 -Dim 64 -Device cuda
```

或直接调 exe：

```powershell
build\memoria_train.exe --data data\tinyshakespeare_3000.txt --save build\checkpoint_demo --epochs 2 --batch 16 --seq-len 16 --vocab 3000 --dim 48 --device cuda
```

常用参数：

| 参数 | 作用 |
| --- | --- |
| `--data` | UTF-8 文本或 LCCC JSON |
| `--save` | 检查点目录 |
| `--load` | 从检查点继续 |
| `--epochs` | 训练轮数 |
| `--max-steps` | 限制步数，便于冒烟 |
| `--batch` / `--seq-len` | 批大小与序列长度 |
| `--vocab` / `--dim` | 词表与隐藏维度 |
| `--device` | `cpu` 或 `cuda` |
| `--metrics` | JSONL 指标路径 |

## 生成

```powershell
scripts\generate.ps1 -Checkpoint "build\checkpoint_demo" -Prompt "What " -MaxNewTokens 8 -Device cpu
```

输出契约：stdout 打印 `checkpoint:`、`device:`、`param_device:`、`generated:`；监控服务抓 `generated:` 前缀。

## 常见问题

- 直接运行 exe 时把 torch 的 `lib` 目录放到 `PATH` 前面。
- CUDA 版在页面文件不足时会报 `0xC000012D`；先用 `memoria_gen_cpu.exe`。
- 找不到检查点：看板用 `MEMORIA_BUILD_ROOT`，或 exe 旁 `model-root.txt`。
- 语料不在默认 `data/`：用 `MEMORIA_DATA_ROOT`。
