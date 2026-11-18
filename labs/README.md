# labs：实验与样例

```text
labs/
├─ benchmarks/   # 原 benchmarks
├─ experiments/  # 原 experiments
├─ examples/     # 原 examples
├─ reference/    # 外部参考实现与源码包，仅本地
└─ sandbox/      # 原 sandbox
```

实验代码可以依赖核心，但核心不能反向依赖 `labs/`。一个实验稳定后，按职责提升到
`src/`、`engine/` 或 `ops/`，不长期留在 `labs/`。
