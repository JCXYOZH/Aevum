/* 由 contracts/errors.json 生成；不要手改。
 * contract MRR1/1  sha256=6ee8ea7b6f42ebd3e2084edc774ea2fe62eaa7b773cd5ba0d1078f79b9988fbc
 * 生成命令：python -m relay.contract_export --out contracts/errors.h
 */
#ifndef MRR_ERRORS_H
#define MRR_ERRORS_H

#define MRR_CONTRACT_MAGIC "MRR1"
#define MRR_CONTRACT_VERSION 1u

#define MRR_ERR_OK 0x000000u  /* HTTP 200 ok */
#define MRR_ERR_R1_SESSION_MISSING 0x010101u  /* HTTP 404 会话不存在或已结束 */
#define MRR_ERR_R1_SESSION_EXPIRED 0x010201u  /* HTTP 410 会话已到期并被清理 */
#define MRR_ERR_R2_MSG_EMPTY 0x020101u  /* HTTP 400 消息内容为空 */
#define MRR_ERR_R2_MSG_LIMIT 0x020102u  /* HTTP 409 会话窗口已满 */
#define MRR_ERR_R2_MSG_TOO_LARGE 0x020203u  /* HTTP 413 单条消息超过字数上限 */
#define MRR_ERR_R2_ROLE_INVALID 0x020301u  /* HTTP 400 role 不在允许集合内 */
#define MRR_ERR_R3_CAPACITY_EXCEEDED 0x030103u  /* HTTP 503 全局会话数已达上限，请稍后再试 */
#define MRR_ERR_R3_SESSION_BUDGET_EXCEEDED 0x030203u  /* HTTP 413 整条消息超出单会话内存预算 */
#define MRR_ERR_R5_TRANSFER_MISSING 0x050101u  /* HTTP 404 传输不存在或已结束 */
#define MRR_ERR_R5_CHUNK_EMPTY 0x050102u  /* HTTP 400 分片为空 */
#define MRR_ERR_R5_TRANSFER_CONSUMED 0x050202u  /* HTTP 409 传输已被取走或已收尾 */
#define MRR_ERR_R5_CHUNK_TOO_LARGE 0x050203u  /* HTTP 413 单个分片超过上限 */
#define MRR_ERR_R5_BUFFER_FULL 0x050303u  /* HTTP 429 接收端没跟上，缓冲区已满 */
#define MRR_ERR_R5_TRANSFER_TIMEOUT 0x050404u  /* HTTP 504 等待分片超时 */
#define MRR_ERR_R6_AUTH_MISSING 0x060101u  /* HTTP 401 缺少访问令牌 */
#define MRR_ERR_R6_AUTH_DENIED 0x060201u  /* HTTP 403 访问令牌不正确 */
#define MRR_ERR_R7_MODULE_MISSING 0x070101u  /* HTTP 500 装载的模块不存在（导入失败，类型 01） */
#define MRR_ERR_R7_CONTRACT_CONFLICT 0x070202u  /* HTTP 500 契约版本冲突或同名模块重复装载 */
#define MRR_ERR_R7_DEPENDENCY_UNMET 0x070303u  /* HTTP 500 依赖层级或版本不满足 */
#define MRR_ERR_R7_RUNTIME_FAILED 0x070404u  /* HTTP 500 运行时装载失败（解释器或环境问题） */
#define MRR_ERR_R9_PATH_MISSING 0x090101u  /* HTTP 404 未知路径 */
#define MRR_ERR_R9_INTERNAL 0x090104u  /* HTTP 500 服务端内部错误 */

#endif /* MRR_ERRORS_H */
