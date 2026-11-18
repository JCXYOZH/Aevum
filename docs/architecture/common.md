# Common 层

`src/shared/common` 是跨模块基础件的候选目录，包含缓存、集合、配置、上下文、日志、注册表、校验和适配器。当前主运行链路主要使用 `src/architecture/libertas/foundation`，`src/shared/common` 仍处于骨架和试验阶段。

边界：`common` 不得反向依赖三个核心运行时或具体业务模块；一个基础件只有在至少两个领域模块真实复用后，才从骨架提升为稳定 API。
