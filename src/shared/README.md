# shared：跨核心基础件

```text
src/shared/
├─ common/        # 缓存、日志、配置、上下文等基础件
└─ integrations/  # redis / postgres / kafka / openai / huggingface 等适配
```

`shared` 不依赖三个核心；核心可以依赖 `shared`。新增基础件先确认至少两个核心
会用到，否则放回使用它的核心目录。
