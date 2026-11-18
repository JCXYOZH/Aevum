# OpenAI 适配

`src/integrations/openai` 用于兼容 OpenAI 风格的聊天与嵌入接口。云端对话在监控服务里通过 `cloud_endpoint`、`cloud_model_name`、`cloud_api_key` 配置，不在前端保存密钥。

默认只在本机开放模型生成；云端模式必须显式开启，并对工具调用做作用域校验。
## 边界

不要把云端密钥写进前端配置或提交到仓库。监控服务只从 `config.yaml` 或环境变量读取；云端失败时返回可读错误，不把上游原始响应直接透给访客。
