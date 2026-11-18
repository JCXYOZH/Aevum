# ops：运维与构建

```text
ops/
├─ deploy/systemd/    # systemd、nginx、安装脚本，原 ops/deploy/systemd
├─ deploy/platform/   # docker、k8s、helm、ansible、terraform，原 deployment
├─ ops/scripts/           # 构建、训练、生成、桌面、发布脚本，原 scripts
├─ tools/             # 审计、检查、生成文档、性能工具，原 tools
└─ bin/               # 开发/测试/部署命令目录，原 bin
```

`ops/` 只放可执行流程，不放业务实现；脚本只调用核心，不把核心代码复制进来。
