# kernel：内核核心

```text
src/kernel/
├─ fortuna/       # 内核主包，原 src/fortuna
└─ host/          # 内核宿主：串口桥、引导盘、机器人例程
```

`fortuna` 保持包名不变；运行 `python` 时把 `src/kernel` 放进 `PYTHONPATH`。

`host/` 只放“让内核跑起来”的宿主代码，不放通用框架能力；新增内核模块进入
`fortuna/` 对应子系统，不放进 `host/`。
