# Aevum 渲染引擎

独立于旧项目的 MMD / VRM / Live2D 渲染引擎，按模块迁移，不做整体搬迁。

完整的架构、模块职责、运行参数和资源约定见 [ARCHITECTURE.md](ARCHITECTURE.md)。

## 当前能力

- **PMX / MMD**：PMX 解析、VMD 采样与播放、Morph、WebGL2 蒙皮渲染。
- **VRM**：GLB / VRM 解析、Humanoid 骨骼、glTF accessor、蒙皮渲染。
- **动作**：glTF 动作采样、Mixamo 到 VRM 重定向、动作状态机、动作融合、IK、布娃娃。
- **Live2D**：Cubism Core、moc3、纹理与遮罩、参数、motion3 播放。

## 目录

```text
engine/
├─ validate.html                # 统一验证页：VRM / PMX / Live2D
├─ models.yaml                  # 模型与动作清单
├─ app/                         # 页面业务入口 validate.js
├─ assets/                      # 本地模型与动作库，不进入版本管理
├─ core/                        # 引擎核心：ECS、渲染循环、资源管线、内存、调度
├─ model/                       # 模型格式、加载器、重定向与压缩
├─ world/                       # 世界、地形、天气、水体、LOD
├─ gl/                          # WebGL 核心、着色器、缓冲、后处理
├─ spirit/render/               # 灵体渲染管线、延迟渲染、材质
├─ spirit/interaction/          # 对话、情感、Live2D 桥、语音
├─ spirit/skin/                 # 皮肤材质、纹理、物理、妆容
├─ orb/split/                   # orb 拆分模块
├─ orb/math.js                  # 向量、矩阵、四元数
├─ formats/                     # PMX / VMD / GLB / VRM / glTF / Live2D 解析
├─ render/                      # WebGL2 蒙皮、动作、重定向、分层、Live2D
├─ action/                      # 人形动作系列，8 个模块
└─ vendor/                      # Live2D Cubism Core
```

## 运行

```powershell
python -m http.server 8766 --directory D:\Aevum
```

渲染验证：`http://127.0.0.1:8766/engine/validate.html`。左侧模型下拉由 `engine/models.yaml` 的 `models` 路径列表生成，格式按后缀自动判断；模型切换用 `?model=<清单里的路径>`，动作可用 `?action=idle|walk|run|greet`，模型清单可用 `?catalog=<url>` 指向另一份 YAML。

Live2D 也在这个验证页里选择，不再单独提供页面。模型路径只写在清单里，页面和 JS 不保存具体模型路径；`models.yaml` 当前是演示路径，换成自己的模型即可。

## 边界

- 脚踝仍是髋部补偿，不是逐骨骼 IK。
- 动作融合只按骨骼分区，没有接触状态权重和左右动作混合。
- 未做 PBR / MToon、SpringBone、手指与表情 Morph。
- Live2D 未接 physics3、PartOpacity 和 Cubism Framework 控制器。
