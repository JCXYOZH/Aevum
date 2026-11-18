# architecture：AI 运行时

```text
src/architecture/
├─ libertas/      # 身份、工具、通知、治理、安全，原 src/architecture/libertas
└─ memoria/       # 训练、生成、检查点，原 src/architecture/memoria
```

两个包名都保持不变；运行 `python` 时把 `src/architecture` 放进 `PYTHONPATH`。

`libertas` 不再承接 Web 业务后端；业务后端已归档到 `archive/backend-python/`。
`memoria` 的 C++ 源码和公共头文件保持在包内，不改 include 约定。
