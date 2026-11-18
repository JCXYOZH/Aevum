# Common 目录说明

本目录说明跨模块基础件的约定，不复制具体实现。

- 缓存、集合、配置、上下文、日志、注册表、校验和适配器优先放 `src/shared/common`。
- 当前主链路实际使用的是 `src/architecture/libertas/foundation`，两套基础件不要在同一调用链里混用。
- 新增基础件必须有明确复用方；只为单个模块服务的工具留在该模块。
## 维护约定

`src/shared/common` 与 `src/architecture/libertas/foundation` 有功能重叠时，以当前调用链实际使用的实现为准，不为了“统一”而大规模搬迁。搬迁前先补引用清单和回归，避免两个基础件同时存在两套行为。
