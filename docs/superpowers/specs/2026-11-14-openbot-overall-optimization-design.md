# OpenBot 整体优化 · 程序规格

2026-11-14 · 分支 `main` · 基线 `7dc48d2`（tag v1.1.0）· 用户请求「优化整体」，选择方向 1+2+3+4 全做。
本规格只覆盖 P1、P2，并把 P3、P4 的立项条件写死；P3/P4 各自另立规格。

## 目标

在不扩大风险面的前提下，把仓库从「门禁绿但留着脚手架」推进到「可交付、可测量、可继续生长」。

## 现状证据

- 门禁：`pnpm typecheck` 通过；`pnpm lint` 0 warning / 0 error；`pnpm i18n:check` 结构合法（16 语言，zh 100%、zh-tw 98%、pt-br 97%）。
- 工作区有 7 个改动文件与 4 个未跟踪文件，其中两个新组件是空壳：
  - `src/components/QuickActionBar.tsx:8` 硬编码 `if (bot.name === "开心")`，动作体是 `console.log("Run summary")`。
  - `src/components/DevToolsDashboard.tsx` 的 `runTest` 全仓无人传入，验证按钮恒为 disabled，永远显示「验证工具尚未接入」。
  - `src/components/Sidebar.tsx:1520` 在一行三元表达式里塞入 emoji 按钮与 `fixed inset-0` 内联弹窗，绕开既有组件与样式体系。
- `electron/port-utils.mjs` 承载真问题（端口被占时应用静默起不来），但实现有三处硬伤：`:15` 只探 `127.0.0.1`；`:21` 只走 `lsof -ti | xargs kill -9`，Windows 失效；`server.once("error")` 把 `EACCES`、`EADDRNOTAVAIL` 一并当作端口被占。
- 打包：`vite.config.ts:53` 无 `manualChunks`；`dist/assets/App-BIf1-VRk.js` 2.2MB；ag-grid 在 2 个文件里同步 import，被卷进主包。`dist` 内 JS 合计 22.9MB / 189 个 chunk。

## 非目标

- 不改付费、额度、充值任何入口（沿用零付费约束）。
- 不动 `server/index.ts` 的既有路由行为（P4 才做搬运，且只搬不改）。
- 不为未列入 P1/P2 的功能顺手加特性。

---

## P1 · 质量收口

### P1.1 删除 QuickActionBar

- 删除 `src/components/QuickActionBar.tsx`。
- `src/components/ChatView.tsx`：删 import 与 `<QuickActionBar bot={bot} />` 渲染点。
- 删除随之失效的 locale 键 `chat.quickAction.summarize`（仅 en / zh / zh-tw 三处存在）。

判定依据：该组件把行为绑在一个具体 bot 名字上，且动作不产生任何实际效果。想保留「快捷操作」这个概念，须另立交互设计，不由这段代码续命。

### P1.2 删除 DevToolsDashboard

- 删除 `src/components/DevToolsDashboard.tsx`。
- `src/components/Sidebar.tsx`：删 import、`devToolsOpen` state、`🛠️` 按钮、`fixed inset-0` 弹窗块，并把被改写的 `SidebarFooter` 那一行恢复为改动前的单表达式形态。
- 删除随之失效的 locale 键 `sidebar.devTools` 与 5 个 `devTools.*`（均只存在于 en / zh / zh-tw）。
- 保留 `native.dialog.portOccupied.*` 三键（en / zh / zh-tw / pt-br 均已存在，P1.3 继续使用）。

判定依据：它永远拿不到 `runTest`，是恒 disabled 的死按钮；仓库已有的 `pnpm test`、`bench:*`、`scripts/` 覆盖了它想表达的能力。

### P1.3 端口冲突处理硬化（保留并做成真功能）

保持现有用户可见行为不变：启动时端口被占则弹窗二选一（结束占用进程并重启 / 退出）。

- `electron/port-utils.mjs` 重写为：
  - `probePort(port)` 返回 `{ free, code }`。双探 `0.0.0.0` 与 `127.0.0.1`：任一绑定失败即视为不可用；失败原因保留，`EADDRINUSE` 与其它错误码分开返回。
  - `killPort(port)` 返回 `{ killed, pids }`。macOS/Linux 用 `lsof -ti tcp:PORT` 取 PID 后逐个 `process.kill(pid, "SIGKILL")`，不经 shell 拼接；Windows 用 `netstat -ano -p tcp` 解析归属 PID 后 `taskkill /PID <pid> /F`。
  - 入参校验：非 1 至 65535 的整数直接抛 `RangeError`。
- `electron/main.mjs`：改用新 API；非 `EADDRINUSE` 错误不再提供「结束进程」选项，改为显示真实错误码，避免误导用户杀掉无关进程。
- 新增 `electron/port-utils.node-test.mjs`（沿用 `electron/*.node-test.mjs` 的 `node:test` 约定）：
  - 占用临时端口后 `probePort` 报 `free:false` 且 `code` 为 `EADDRINUSE`；
  - `killPort` 能取到该 PID，释放后 `probePort` 报 `free:true`；
  - 只绑 `127.0.0.1` 的监听也能被识别（验证双探）；
  - 非法端口抛 `RangeError`。

### P1 验收

`pnpm typecheck`、`pnpm lint`、`pnpm vitest run`、`pnpm test:electron`、`pnpm i18n:check` 全绿；`grep -rn "QuickActionBar" src` 与 `grep -rn "DevToolsDashboard" src` 均无命中；端口冲突路径按 `docs/verification/README.md` 在隔离 fixture 上跑通并留截图。

---

## P2 · 性能

### 先量基线

开工前跑 `pnpm bench:desktop`（必要时补 `bench:observation`），记录冷启动到可交互耗时、消息列表滚动帧率、`dist` 体积与 chunk 分布。基线数字写进提交说明，后续所有改动对照它。

### 拆包

- 把 ag-grid 从同步依赖改为按需加载：`DataPanel` 走动态 `import()`，`vite.config.ts` 增加 `manualChunks`，把表格、图编辑器、novnc 等重依赖放进独立 chunk。
- 目标：`App-*.js` 主 chunk 从 2.2MB 降到 1.2MB 以内；首屏同步加载的 JS 总量下降 40% 以上。
- 不在本阶段做消息列表虚拟化重构——那是独立议题，需先有滚动性能基线。

### P2 验收

给出前后对照表（主 chunk 体积、首屏 JS 总量、冷启动耗时、滚动帧率）；`pnpm build` 通过；`pnpm test` 全绿；应用能正常启动并完成一次真实对话。

---

## P3 · 功能对齐（本规格不实施）

范围只剩 `docs/replication-gaps.md` 的 GAP-001：保险库的「支付」「联系信息」两栏计数硬编码为 0，且测试把空态锁成契约。

已定方向：只做「联系信息」（真实数据模型，可被 bot 读取代填，与登录信息同级权限）；不引入卡号/CVV 存储，支付分栏明确标注不支持或移除。

立项条件：P1 验收通过。届时的规格必须先定义可见字段白名单、代填链路与「bot 永远看不到卡号/CVV」这条不变量，并同步改写 `src/components/SimpleVaultPage.test.ts` 里锁死空态的断言。

## P4 · 架构重构（本规格不实施）

`server/index.ts` 15,862 行，`server/routes/` 已有 24,350 行，说明抽取路径存在。

已定方向：逐块「只搬不改」抽取，每块独立提交并跑全量测试，不做顺手重写。

立项条件：P2 验收通过，且工作区干净（无未提交改动）。万行级搬运必须建立在稳定测试基线之上。

---

## 风险与回滚

| 阶段 | 主要风险 | 处理 |
| --- | --- | --- |
| P1 | 删除后仍有引用 | 单次提交内完成组件、locale、挂载点三处删除，可整体 revert |
| P1.3 | `killPort` 误杀无关进程 | 只按端口精确取 PID；非 `EADDRINUSE` 不给杀进程选项 |
| P2 | 动态 import 改变加载时序，出现白屏或竞态 | 每个 chunk 单独提交并做一次真实启动与对话验证 |
| P3/P4 | 安全边界与回归面 | 另立规格，不在本规格内启动 |

## 验证

遵循 `docs/verification/README.md`：一律在隔离 fixture 上验证，绝不对用户正在使用的应用或数据做变更验证；单测通过不等同于真实会话可用，端到端须另有证据。

---

## 实施记录（2026-11-14）

### P1 已落地

提交 `d249ea2`（7 文件，+281）：

- `electron/port-utils.mjs`：`probePort` 双探 `0.0.0.0` 与 `127.0.0.1`，`EADDRINUSE` 与其他错误码分开返回；`killPort` 按端口取 PID 后直接 `process.kill`（Windows 走 `taskkill /PID /F`），不经 shell；非法端口抛 `RangeError`。`ensureServerPort` 承担对话框决策：只有确认端口被占时才提供「结束占用进程并重启」，其余错误码只给「退出」。
- `electron/main.mjs` 只加 3 行（import、空行、一次调用），文件停在 3224 行 —— 正好是 `scripts/testing/file-size-ratchet.test.ts:21` 登记的上限；初版把 19 行内联逻辑写进 `main.mjs` 时该门禁报 `grew to 3243 (listed at 3224)`，改为抽到 `port-utils.mjs` 后通过。
- `electron/port-utils.node-test.mjs`：9 个用例，其中一个真的 `spawn` 子进程占住端口，再断言「结束并重启」路径杀掉它并调用 `relaunch`/`exit(0)`。
- 四个 locale 各加 5 个键（`native.dialog.portOccupied.*`、`native.dialog.portUnavailable.*`）。

两个空壳组件（`QuickActionBar.tsx`、`DevToolsDashboard.tsx`）在本次之前从未进入 git（一直处于未跟踪状态），删除后不留 diff，全仓 grep 无残留引用。

门禁：`pnpm typecheck` 退出 0；`pnpm lint` 0 warning / 0 error；`pnpm i18n:check` 16 语言 / 10094 条合法；`node --test electron/port-utils.node-test.mjs` 9/9。

未完成的 P1 验收项：端口冲突对话框的隔离 fixture 截图。应用端口固定为 8799，被用户正在运行的应用占用；另起一个实例弹出的对话框默认按钮是「退出」，但 `cancelId` 指向「结束占用进程并重启」，任何误触都会杀掉用户当前实例，因此这一步没有在用户在场时执行。

### 全量测试基线（macOS 本机，host 模式）

`OMB_VITEST_E2E=host pnpm vitest run`：2164 个测试文件，2106 通过、47 失败、11 跳过；30520 个用例中 30346 通过、82 失败，耗时 877s。

把 P1 的改动 stash 掉、只跑那 42 个失败文件做对照：80 个失败。说明这 80 个失败是本 checkout 既有状态，与本阶段改动无关，例如：

- `scripts/testing/analytics-docs.test.ts`：`docs/analytics.md` 在仓库里既不存在也未被 git 跟踪。
- `scripts/testing/duration-sequencer.test.ts`：`vitest-shard-weights.json` 里登记了本 checkout 没有的文件。
- `shared/package-format.test.ts`：`legacy-team.v1.json` 与 `legacy-botmrr.v1.md` 的 sha256 与 manifest 不符。
- `server/phone-secret.test.ts`：CryptoKit HPKE 信封被拒。

差异只有两个：`file-size-ratchet`（上面已修）与 `server/drivers/codex-device-auth.test.ts` 的一条（单独重跑通过，属抖动）。

### P2 不实施：实测数据

用 `vite build --sourcemap` 输出到临时目录后按 `sourcesContent` 归因：

| chunk | 体积 | 构成（源码字节） |
| --- | --- | --- |
| `App-*.js` | 2249 KB | `src/components` 2544K、`src/lib` 815K、`src/state` 232K、`lib/index.js` 225K、`src/data` 137K；第三方只有 tldts 144K、lucide-react 124K、micromark/mdast/unified 合计约 350K |
| `elk-*.js` | 1442 KB | elkjs |
| `DataPanel-*.js` | 1119 KB | ag-grid-community 2374K、codemirror 约 1000K |
| `cpp-*.js` | 778 KB | shiki 语言包 |
| `embed-*.js` | 757 KB | vega-lite 全家桶 |
| `zh-*.js` / `pt-br-*.js` | 670 / 706 KB | 单语言包 |

`index.html` 实际同步加载的只有 2 个文件、合计 0.92 MB（`styles-*.js` 中 react-dom 533K、tailwind-merge 103K，加 38K 的入口）。

结论：

1. ag-grid、elk、shiki、vega、语言包早已各自成 chunk，「把 ag-grid 改成动态 import」已无收益。
2. `manualChunks` 只能把 `App` 里约 0.6 MB 的第三方挪出去，把主 chunk 压到 1.2 MB 意味着压缩应用自身代码；而首屏同步 JS 只有 0.92 MB 且由 react-dom 主导，再降 40% 在当前分层下不可能。
3. 要真正减少首屏主线程字节，只能把 `src/components` 按路由/面板懒加载，这需要真实浏览器逐屏回归，属于独立一轮工作，不能顺手做。

建议 P2 另立规格，范围改为「按路由/面板拆 `src/components` 并逐个懒加载」，验收用 Lighthouse/Performance 面板的真实首屏指标，而不是主 chunk 体积。
