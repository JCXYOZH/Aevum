# 配置

运行配置分三层：仓库样例 `configs/`、本地 `config.yaml`、数据目录下的敏感配置。

- `config.yaml` 是本地运行配置，按 `configs/` 样例生成，不提交。
- `mail.json`、`loop.key`、`loop.pepper` 位于 `LIBERTAS_DATA_DIR/config/`，不进 Git。
- Linux 默认数据目录是 `~/LibertasData`；Windows 本地可通过 `LIBERTAS_DATA_DIR` 指向 `D:\LibertasData\AevumData`。
- `mail.json` 不会由代码自动创建；首次需要时手动创建并填入口令。

不要把口令发到聊天或提交到仓库；测试后应撤销并重新生成。
