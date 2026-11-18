# HuggingFace 适配

`src/shared/integrations/huggingface` 提供 model、pipeline、tokenizer 适配。它只做加载与调用转换，不把模型权重放进仓库。

使用前确认本地缓存目录和离线模式；CI 使用 mock，不下载真实权重。新增模型族时先补 tokenizer 与输入形状测试。
## 边界

适配器不负责模型选型、不负责训练、不负责缓存清理策略。调用方需要自己决定离线/在线、设备、精度和超时；适配器只把请求转成 HuggingFace 的加载与推理接口。
