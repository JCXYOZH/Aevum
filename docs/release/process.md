# 发布流程

1. 在 `main` 上完成代码与文档，跑静态审计和编译检查。
2. 构建 Memoria、桌面壳和安装器；产物放 `build/`，不进 Git。
3. 更新 `CHANGELOG.md` 与版本号；发布说明写清新增、修复和已知限制。
4. 服务器同步代码后，运行部署验收脚本；根页必须命中 `data-page="showcase"`。
5. 模型权重走 Release 附件或对象存储，不塞进仓库。

发布前确认没有把 `mail.json`、`loop.key`、`loop.pepper` 或本机绝对路径带进提交。
