# Grok Bot 1.0 差异初查

2026-11-12。依据 [Grok Bot 1.0 发布说明](https://x.ai/news/grok-bot-1-0)和[更新日志](https://x.ai/changelog/bot)（1.0.1 条目包含 1.0.0）。以下是代码线索，不代表端到端功能已经验证。

| 功能 | OpenBot 当前线索 | 后续验收 |
| --- | --- | --- |
| 团队 Bot、成员权限及私聊 | `shared/bot-access.ts`、`server/cloud-team-bot-access.e2e.test.ts`、`server/cloud-team-private.e2e.test.ts` | 隔离团队中验证共享范围、成员权限和私聊隔离。 |
| 团队共享连接器 | `server/host/team-connections-host.ts`、`shared/connector-scopes.ts` | 确认是否支持管理员启用后的个人账号共享、授权撤销及调用归属；不能将现有权限代码直接视为完整实现。 |
| 团队学习审核 | Team Cloud 共享记忆提案已改为等待审核；隔离测试覆盖管理员批准、成员访问限制，以及批准和拒绝后的上下文。个人模式仍允许原有直接应用 | 补齐 Bot Manager 审核、私聊中的安全提案和团队技能审核；进一步核验冲突和撤销。技能审核不等同于团队记忆审核。 |
| 会议：Google Meet、Teams、Zoom | `shared/meetings.ts` 与 `server/meetings/meetbot.ts` 已支持 Meet、Teams、Zoom 与 Jitsi 链接解析与 prejoin 适配；`server/drivers/agents-meeting-tools.ts` 定义全套会议工具 | 单元测试全绿；在沙箱隔离环境中持续核验入会、告知、聊天、离会与摘要。 |
| Microsoft Teams 消息中的团队 Bot | 团队和会议代码不能证明 Teams 消息集成 | 核对连接器、管理员授权、消息路由与回复归属，再实施。 |
| 主动建议与跟进 | `server/host/proactive.ts` 和 `server/host/helper-suggestion.ts` | 验证建议来源、去重、授权、停用及未完成事项跟进，不把建议等同于自行执行。 |
| 语音速度 0.5×–2× | `server/live-config.ts`、`server/routes/live.ts`、`src/lib/live-call-media.ts` 当前限制为 0.75×–1.5× | 先验证实时流在目标浏览器和 Electron 上的变速机制，再统一界面、校验、持久化和播放；不能仅放宽数字范围。 |
| 浏览器、文档与演示文稿能力提升 | 官方没有给出可直接对照的性能指标 | 用可复现任务和质量指标建立基线，不以宣传语代替测试结果。 |
| 宽表格、创建进度、文件与界面修复 | 尚未逐项核查 | 分别复现、确认当前行为及原版适用条件，补充回归验证。 |
| 无内容时避免无意义消息 | 尚未逐项核查 | 构造无结果任务，确认不会发送空泛完成消息，同时保留错误及需要用户处理的通知。 |

订单与支付相关更新不纳入：本项目明确禁止支付流程。

团队学习的 Manager 审核不能直接复用现有 `edit` 权限：该权限可授予全员或邮箱域名，而当前团队记忆按 section 注入给多个 Bot。后续需引入明确的逐 Bot Manager 授权，以及按 Bot 归属的学习提案和已批准上下文；旧 section 记忆保留既有语义，不自动转移。服务端需对每次列表、审核和撤销按当前成员身份、目标 Bot 与提案版本鉴权，并验证同部门两个 Bot 间的隔离、权限撤销、并发更新和私聊隐私。

建议优先验证已有能力和团队数据隔离，再实现缺失的审核、会议或连接器功能。每项应分别记录模拟测试、隔离端到端测试及真实第三方联调结果。按项目约束使用隔离 fixture，不对用户的真实应用或数据进行变更验证。验证入口及隔离限制见 `docs/verification/README.md`；使用 fixture 时仍需验证具体数据、进程和网络隔离范围。
