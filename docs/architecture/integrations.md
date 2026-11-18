# Integrations

`src/shared/integrations` 放外部系统适配：Elasticsearch、Grafana、gRPC、HuggingFace、Kafka、Kubernetes、LangChain、OpenAI、Postgres、Redis 等。适配器只负责协议转换和凭据读取，不承载业务规则。

凭据只从环境变量或本地配置读取，不写进仓库。新增适配器要提供离线 mock 测试，避免 CI 依赖真实第三方服务。
