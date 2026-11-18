# 真实服务联调 / 功能闭环 / 跨引擎一致性 — 2026-11-13

隔离 fixture + 本机真实登录态。没有向用户的真实应用数据写入任何测试消息；真实模型调用只用了两轮 Codex、一次 Claude 失败轮，以及若干次引擎自检。

## 结论（含修复后复验）

| 引擎 | 就绪快照 | 引擎自检 | App 内真实对话 | 工具调用 | 结论 |
|---|---|---|---|---|---|
| Claude（claudeAgent，本机 2.1.322） | available / authenticated | 仍超时（中转单次约 190 秒，自检上限 90 秒） | 失败，但文案与恢复行为已修：192 秒报额度耗尽、只执行 1 次、无自动重试、线程 failed | 未测（账号额度耗尽） | 失败分类、重试、后台调用鉴权已修；账号额度本身仍不可用 |
| Codex（codex，codex-cli 0.167.0） | available / authenticated | ok | 通过（PARITY OK） | 通过（写文件并回读 hello） | 主链路可用 |
| Grok（grokAgent） | unavailable：`grok` 未安装 | 已修：安装提示，不再抛 `spawn ENOENT` | 未开始（建 bot 即被拒，已带原因） | — | 自检与建 bot 提示均已一致 |

功能闭环（持久化/重启）用 fake 引擎单独验证：通过。

## 怎么跑的

- `node --experimental-strip-types scripts/control-omb.ts launch` 起隔离 fixture，再在 fixture 的 config 里加真实实例（只复用本机 CLI 与登录态，数据目录仍是临时目录）。
- 之后的复验改用自建 fixture：先写 config.json（含 `claude-live`、`grok-live`），再按 fixture 相同环境启动 server（`http://127.0.0.1:23210`，数据目录 `.../omb-live-claude-NUfxcV`）。这样实例在启动时就存在，避免运行中改 config 不生效。
- 真实实例的环境只覆盖 `HOME / PATH / CLAUDE_CONFIG_DIR`（Claude 另给 `config.cli` 绝对路径）；所有 fixture 写入都落在临时目录。
- 对话走 `control-omb run --wait turn`，结果读 `messages`，引擎自检走 `POST /api/instances/<id>/check`。
- 重启验证：复制 fixture 数据目录 → 停服 → 用副本和同样的 `OMB_DATA_DIR` 重启 → 读历史并续聊。

## 证据

### Codex 真实闭环

- 一次性调用：`codex exec` → `PARITY OK`。
- App 内：thread `2a6ae3b0-6078-4255-b19a-ebf00d43fb88`，回复 `PARITY OK`。
- 工具轮：thread `821615bf-623f-4181-b414-028f0aae0cdf`，回复 `hello`，`parity.txt` 写在该 thread 的 task workspace 下。
- 引擎自检：`{"ok":true}`。
- 环境侧告警：`codex_models_manager::manager: failed to refresh available models: request timed out`（回退默认模型后仍成功）。

### Claude 真实闭环（失败，修复后复验）

原始失败（修复前）：thread `5d289cfa-b475-4049-b6cf-96bc93e264b8` 报 `Claude hit a rate limit (HTTP 429; ... API key 额度已用完). Wait a minute`，随后自动重试一次，重试轮无输出，线程 10 分钟以上仍 `running`。

修复后（thread `175ec804-f2d8-4cc9-a55d-f316cf84d7b3`）：

- 请求 1794553261394 发出，1794553453735 结束（约 192 秒）。
- 用户可见错误：`This Claude account has reached its usage limit (Claude says: "API Error: Request rejected (429) · API key 额度已用完"). For now, switch this bot to another AI or Claude account.`
- job：`executions: 1`、`state: failed`、`failed: 1`、`running: 0` —— 没有第二次自动重试，也没有卡在 running。
- 说明 `USAGE_LIMIT` 的中文语义同时修掉了“额度耗尽仍重试”。

后台调用鉴权（本轮新增修复的复验）：

- 修复前自检把同一失败报成 `Claude live isn't signed in ...`，根因是 `generateReview` 的 `--settings` 是隔离配置，丢掉了 `~/.claude/settings.json` 里的 `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN`。
- 修复后按同样参数、把账号 env 注入子进程直接调用，返回 `API Error: Request rejected (429) · API key 额度已用完`，不再报未登录。
- 自检接口仍返回 `Claude live didn't answer within 90 seconds.`：中转单次约 190 秒，超过自检上限。这是时间上限，不是鉴权。

### Grok 未就绪（修复后复验）

- 快照：`unavailable`，原因：`` `grok` isn't installed, or isn't on this app's PATH ... ``。
- 自检：`{"ok":false,"error":"Grok live isn't installed on this computer anymore. Install it, then check again."}`（修复前是 `spawn grok ENOENT`）。
- 建 bot（`POST /api/bots`，`requireAvailableModel: true`）：
  `400 {"error":"model instance \"grok-live\" is unavailable: \`grok\` isn't installed, or isn't on this app's PATH. Install it for the user running OpenBot or use Set CLI, then check again."}`
  （修复前：同一请求 201 建出 bot，id `483d3780-4df9-4bdf-867e-ea645e75b4d7`）。
- `new-bot --model grok-live/grok-4.5` 与 HTTP 走同一判定；它此前缺原因，是因为创建路径没有取实时快照。

### 持久化 + 重启

- thread `5afb5dfc-6a5a-4491-b2f7-b4588dc69d06`：重启后 bot、thread、两条消息都在，续聊成功。
- 注意：fixture 正常关闭会删临时数据目录，验证重启必须先复制数据目录。

### 外部服务

- MCP 配置 20 个，`mcp-health.json` 16 条检查：15 ok / 1 fail。
- 失败项 `cursor-model-router`：`The server stopped before the MCP handshake finished.`，根因是本机 `python3` 缺 `mcp` 包（`ModuleNotFoundError: No module named 'mcp'`）。
- 云账号：本机有 `~/Library/Application Support/OpenBot/cloud-sync/{settings.json,state.db}`，但云凭据在 `credentials.bin`（safeStorage），CLI 无法完成真实云端联调。
- 浏览器：fixture 临时 HOME 下报 `agent-browser` 未安装，属于隔离环境限制，不作为产品问题。
- 团队/会议/飞书等第三方：未跑真实联调。

## 已实施的修复

1. **P0 额度耗尽被判成限流** — `server/drivers/retry.ts` 的 `USAGE_LIMIT` 增加中文额度语义（额度/配额/用量/余额 + 用完/用尽/耗尽/不足/超限，以及“已达/超出…上限”）。`classifyRoutineFailure` 通过 `engineFailureKind` 读它，因此自动重试一并修掉。
2. **P1 引擎自检误判未登录** — `server/engine-check.ts` 新增 `PROVIDER_REFUSAL`，在 `SIGNED_OUT` 之前用 `engineFailureMessage` 判额度/限流；429 额度不再报“未登录”。
3. **P1 原始系统错误外泄** — 同文件新增 `MISSING_CLI`（`spawn ... ENOENT` / `command not found`），改为安装提示。
4. **P1 不可用实例提示** — `server/index.ts` 不可用实例错误处按 registry 的 shadow reason 追加原因；拿不到 reason 时保持原文。
5. **P1 后台调用丢账号鉴权** — `server/drivers/claude.ts` 的 `generateReview` 把实例账号的 `settings.json` env（中转 base URL、token、型号映射）注入后台 CLI 环境，`--settings` 仍保持无 hooks。
6. **P1 建 bot 的可用性判定不一致** — `server/routes/bots-create.ts` 在 `requireAvailableModel: true` 时取实例实时快照，不可用则带 `reason` 拒绝；`server/index.ts` 的内部 `create-bot` 路径同样在选中模型后检查。可用的 Claude 实例仍能正常建 bot（201）。
7. **测试** — `retry.test.ts`、`engine-errors.test.ts`（中文 429 额度两例）、`engine-check.test.ts`（429 不判未登录 + ENOENT 安装提示）、`routine-recovery.test.ts`（中文额度两例，含本地化后的限流提示）：
   - 四个文件 `105 passed`；`routine-recovery.test.ts` 单独 `64 passed`。
   - `npx tsc -p tsconfig.server.json --noEmit` 通过；`oxlint --deny-warnings` 对改动文件 0 warning / 0 error。

## 仍未解决

1. **P1 自检上限 90 秒低于中转响应时间**：该账号单次约 190 秒，自检只能报超时。可考虑按实例历史耗时放宽，或在超时时附“上次失败原因”。
2. **P2 MCP 依赖缺失**：`cursor-model-router` 缺 Python `mcp` 包，工具对所有 bot 关闭；应提示安装或使用自带 venv。
3. **P2 Codex 模型目录刷新超时**：真实 CLI 报 `codex_models_manager` 刷新超时，虽回退成功，但模型列表可能过期。
4. **P2 模型目录与中转配置不一致**：App 展示 Claude 型号，本机 settings 把 Sonnet/Opus/Haiku 映射到 `gpt-5.6-luna` 并走第三方中转；用户看到的模型与实际请求可能不同。
5. **P3 等待提示噪音**：真实轮次 20 秒时仍出现 “didn't hear back” 通知，随后才失败；不影响结果，但可对已知慢引擎延后提示。

## 未覆盖

- 云端电脑、云同步的真实读写（需要 Electron 凭据）。
- 浏览器真实端到端（需要安装 agent-browser 运行时）。
- 飞书/Teams/会议连接器的真实联调。
- 跨引擎 UI 截图对比与审批交互（本轮只验证了 API/消息层）。
