# AI 动作架构现状与导入约定

> 这轮没有把代码整理好。当前提交只保存现状，目录、模块边界和接口还会继续调整；不要把这里的结构当成最终架构。

## 1. 实际代码位置

| 部分 | 位置 | 状态 |
| --- | --- | --- |
| Memoria C++ | `src/architecture/memoria/*.cpp` | 可编译，训练/生成/检查点已接 |
| Memoria 公共头文件 | `src/architecture/memoria/include/*.h` | 已从 `include/memoria/` 移到 `include/` 直属 |
| Memoria 公共入口 | `src/architecture/memoria/include/aevum_core.h` | 唯一入口，文件名不带 `memoria` |
| AI 动作桥原型 | `tools/ai-bridge/` | 未接入运行时，仍是独立原型 |
| 动画运行时 | `engine/animation/` | 已有动画底座，尚未接标签向量 |

`tools/ai-bridge` 当前只有：

- `label_vector.hpp`：33 维标签定义与中英文规则编码
- `ai_action_bridge.cpp`：WinHTTP 调本机 `llama-server`，把模型文本编码成标签向量，输出带时区 JSON
- `sample-thought.txt`：测试文本

编译产物 `ai_action_bridge.exe` 不提交；它只是本机验证用的临时二进制。

## 2. 导入路径

Memoria 的编译根是：

```bash
-I<repo>/src/architecture/memoria
```

因此所有 `src/architecture/memoria/*.cpp` 统一写：

```cpp
#include <include/aevum_core.h>
```

`aevum_core.h` 内部同样用 `<include/...>` 包含各模块头文件。同目录模块之间仍用 `"chain_unit.h"` 这类相对包含，避免把公共路径散落到每个文件。

`tools/ai-bridge` 不在 Memoria 的 include 根内，`ai_action_bridge.cpp` 只写：

```cpp
#include "label_vector.hpp"
```

后续如果把动作桥收进正式运行时，需要重新确定 include 根，不能直接把 `tools/ai-bridge` 的相对包含带进 `src/`。

## 3. 已实现的链路

当前只有前半段：

```text
模型文本
  -> 33 维标签向量
  -> 带完整年月日时间的 JSON 行
```

33 维标签分五段：

- 0–12：身体部位，如 `root`、`spine`、`left_arm`、`right_hand`、`left_leg`
- 13–20：动作，如 `reach`、`wave`、`look`、`step`、`turn`
- 21–26：目标，如 `camera`、`front`、`up`、`down`
- 27–29：幅度，如 `small`、`medium`、`large`
- 30–32：速度，如 `slow`、`normal`、`fast`

这条链路还没有接到 `engine/animation`，也没有参数化树、YAML 注册表、JSON 记录提取和成功判定。

## 4. AI 控制角色的讨论结论

设计目标：模型能自由、连续地控制角色动作，但模型不逐参数调参，也不操作控制台。

约束：

- 模型是脑，运行时是脊髓/小脑；模型只产生动作意图，程序负责生成合法关节动作。
- 模型不直接选择大量动作参数，也不通过向量标签检索动作。
- 不做每角色一套动作参数配置；不做逐参数调试。
- 注册表是可选加速层，不是唯一控制入口；成功动作从 JSON 记录中提取，再写入 YAML 注册表。
- 每条记录带完整年月日时间，便于回溯“哪个参数和字段是对的”。
- 模型只需要知道注册表，不需要自己总结动作规律。
- 模型仍然知道自己控制角色，但操作是自动的；它获得的应该是“身体感”，不是控制台感。

参数化树的字段要具体到 `left_leg`、`right_leg`、`left_arm`、`right_arm`、`left_hand`、`right_hand` 这一级，不能只用笼统的 `limb` 或 `body`。

## 5. 未完成

1. AI 动作桥还没有接运行时，标签向量还不能驱动角色。
2. 参数化树尚未完整暴露，字段和运行时关节的映射未定。
3. YAML 注册表读写、JSON 记录提取、成功动作判定都未实现。
4. 记录时间戳已有，但还没有和动作结果、参数快照关联。
5. Memoria 迁移仍有缺口：`SandwichFusion`、模型保存/加载、V 演化分析、完整 `EnhancedEmbeddingLayer` 统计等未补齐。
6. 目录和模块边界还没有整理好，后续需要继续整理；这轮提交只保证现状可追溯。
