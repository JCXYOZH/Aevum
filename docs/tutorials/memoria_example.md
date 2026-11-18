# Memoria 示例

Memoria 是 C++ 训练/生成内核。先按 `docs/guides/development.md` 构建 `build/linux/memoria_train` 与 `memoria_gen_cpu`，再用小语料跑一轮冒烟训练。

生成服务由监控服务通过 `--model-exe`、`--model-data` 启动；不要把训练权重提交到仓库。没有构建产物时，模型接口应返回明确的 503，而不是伪造结果。
