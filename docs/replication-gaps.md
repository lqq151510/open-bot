# Grok Bot 复刻差异清单

> 用途：记录「制作我自己的应用版本，在当前基础上改进，实现完美复刻」（见 craft.json 的 request）
> 过程中，参考图与原版产品面一致、但当前工程尚未具备的能力。只记差异，不改实现。
>
> 记录日期：2026-11-10 · 分支 cursor/vault-logins · HEAD `01f4c19` · craft.json status=building / builder=Antigravity
> 证据基准：`reference/picture-7.png`（原版「保险库」页，2304x1744）；`capture/README.md` 说明
> `/Applications/Grok Bot.app` 只是文件夹、无可执行体可反编译，故 13 张参考图是产品面的唯一证据。

---

## GAP-001 · 保险库：支付 / 联系信息分栏无对应产品能力

**用户笔记（m00001 逐字）**：`保险库支付 / 联系信息分栏 产品面不同：目前只有登录信息 + 1Password`

**判定**：成立。分栏的「壳」已仿出，但底层能力面仍只有登录信息 + 1Password；
`支付` 与 `联系信息` 两个标签是空壳，且数据模型、存储、代填链路、i18n 均不存在。
本次按 A 方案只记录，不改实现代码。

### 原版（参考图 picture-7）行为

- 标题「保险库」，右上「新项目 ▾」黑色按钮。
- 标签行：**「全部 3 / 登录信息 0 / 支付 0 / 联系信息 3」** + 「搜索保险库」搜索框。
- 列表 3 条，均为联系信息类：
  1. 「Grok Bot 邮箱 / 2141445126I-kaixin@mail.grokbot.com」右侧「管理」按钮（粉色方块图标）；
  2. 「longyu（小红书监控）/ longyu@fbxbio.cn」右侧 chevron；
  3. 「Me / 勇泽」右侧 chevron（人形图标）。
- 底部隐私说明（zh 逐字）：
  「Grok Bot 永远看不到已保存卡片的卡号或安全码。它可以看到登录信息和联系信息，以便替你填写。」
- 即原版把「联系信息」当作可保存、可代填的一类真实资产；「支付」标签存在但计数为 0。

### 当前实现（复验于 2026-11-10 22:19–22:39，HEAD 01f4c19）

| 分栏 | 参考图 | 当前实现 | 是否真实能力 |
| --- | --- | --- | --- |
| 全部 | 3 | `loginCount`（真实登录条数） | 是，仅登录信息 |
| 登录信息 | 0 | `loginCount`（真实登录条数） | 是 |
| 支付 | 0 | 计数硬编码 `0`，空态「没有匹配的项目」 | 否，无卡片数据模型 |
| 联系信息 | 3 | 计数硬编码 `0`，空态「没有匹配的项目」 | 否，无联系人数据模型 |

- 「新项目」按钮现在**有** onClick，但只打开「添加登录信息」表单——没有「新建支付 / 新建联系信息」流程。
- 「搜索保险库」只作为 `query` 传给 `<LoginsSettings>`，搜索范围仅登录信息。
- 隐私说明文案已逐字对齐参考图，但描述的两类能力（卡片、联系信息）在当前工程都不存在。

### 代码证据（路径:行号均可直接 grep）

**UI 壳 — `src/components/SettingsSimplePages.tsx`**（2026-11-11 按当前文件重对行号；支付/联系信息行为没变）
- `:466` `export function SimpleVaultPage({ onReady }: { onReady?: (open: () => void) => void } = {})`
- `:467` `const [tab, setTab] = useState<"all" | "logins" | "payments" | "contacts">("all");`
- `:471` `openLoginForm` 只把 tab 收敛到 `"logins"` 并 `setOpenAdd`（递增打开表单）。
- `:480` `const showLogins = tab === "all" || tab === "logins";`
- `:481` `const contactBox = tab === "payments" || tab === "contacts";`
- `:490` `{t("settings.vault.tabAll")} {loginCount}`；`:493` `{t("settings.vault.tabLogins")} {loginCount}`（真实计数）。
- `:496` `{t("settings.vault.tabPayments")} 0`；`:499` `{t("settings.vault.tabContacts")} 0`（**硬编码 0**）。
- `:514-519` `contactBox && (... 没有匹配的项目 ...)` —— 支付/联系信息两栏共用的写死空态；文案未走 i18n。
- `:522` `{showLogins && <LoginsSettings query={search} onListed={setLoginCount} openAdd={openAdd} />}` —— 唯一真实数据组件。
- `:524-526` `{t("settings.vault.privacyNote")}`。

**入口与按钮 — `src/components/SettingsModal.tsx`**
- `:128` `{ id: "vault", labelKey: "settings.simple.page.vault", icon: Archive, sections: ["logins"], keywords: ["logins", "passwords", "vault", "sign in"] }` —— 保险库页的 section 只有 `logins`。
- `:195-196` `const openVaultAdd = useRef<() => void>(() => {});` / `const registerVaultAdd = useCallback((open: () => void) => { openVaultAdd.current = open; }, []);`
- `:429` `case "logins": return <LoginsSettings />;`（高级模式）。
- `:459` `case "vault": return <SimpleVaultPage onReady={registerVaultAdd} />;`（simple 模式）。
- `:573-574` 「新项目」按钮 `onClick={() => openVaultAdd.current()}` → `{t("settings.vault.newItem")} <ChevronDown size={14} />`；只能打开登录表单。

**真实能力面 — `src/components/LoginsSettings.tsx` / `shared/logins.ts` / `src/lib/logins.ts`**
- `src/components/LoginsSettings.tsx:23` `export function LoginsSettings({ onListed, query = "", openAdd = 0 }: {...} = {})`；`:51` `onListed?.(answer.logins.length);`。
- `src/components/LoginsSettings.tsx:13` `// Security: a row never shows the password, which no route returns.`
- `src/components/LoginsSettings.tsx:15-19` `const SOURCE_KEYS = { card: "settings.logins.source.card", settings: "settings.logins.source.settings", "1password": "settings.logins.source.1password" } as const;`
- `shared/logins.ts:11` `export type LoginSource = "card" | "settings" | "1password";` —— 全量来源枚举，无 payment/contact。
- `shared/logins.ts:31/44/54` `export interface LoginSummary`, `export interface OnePasswordVault`, `export interface OnePasswordStatus` —— 仅登录/1Password 模型。
- `src/lib/logins.ts:12,17,21,25,29,36,49,56,66,70` 导出 `listLogins / connectOnePassword / refreshOnePassword / disconnectOnePassword / addLogin / changeLogin / grantVault / deleteLogin / cardSaveTarget / saveLoginFromCard`，全是登录与 1Password。
- `server/login-store.ts`、`server/login-fill.ts`、`server/onepassword.ts`、`server/login-handoff.ts` —— 服务端只有登录/1Password 路由。
- 全仓 grep `vault.*(payment|contact)|cc-number|cardNumber|cvv`：命中仅 `server/browser/cdp/sensitive.ts:2`、`server/browser-steps.ts:83-84,215` 的敏感输入框识别正则（用于拦截模型读取），**不是**保险库支付/联系信息功能；无任何 payment/contact 保险库实体或路由。

**测试把空态锁成了预期 — `src/components/SimpleVaultPage.test.ts`**
- `:121` `it("leaves payments empty, with no card field and no login form", ...)`；断言 `expect(tabText("payments")).toBe("Payments 0");`、`expect(host.textContent).toContain("没有匹配的项目");`、`expect(host.querySelector("[data-login-row], [data-login-form], input[name='password'], input[autocomplete='cc-number']")).toBeNull();`
- `:131` `it("shows the existing empty copy for contacts, with no saved rows and no password text", ...)`；断言 `expect(tabText("contacts")).toBe("Contact info 0");` 并排除 `示例联系人 / 示例邮箱 / 我的资料 / contact@example.com`。
- `:145` `it("opens the existing add-login form from New item, including from the empty contacts tab", ...)`。
- 即支付/联系信息为空是**当前测试契约**，补齐功能需同步改测试。

**i18n — `src/locales/*.json` / `src/lib/i18n.ts`**
- `src/locales/zh.json:6452-6458` 与 `src/locales/en.json:6648-6654` 各有 7 个 `settings.vault.*` 键（newItem / search / tabAll / tabLogins / tabPayments / tabContacts / privacyNote）。
- 共 17 个 `src/locales/*.json`，**只有 en.json 与 zh.json** 含 `tabPayments` / `tabContacts`；其余 15 个（de/es/fr/hi/it/ja/ko/pl/pt-br/ru/tr/uk/vi/zh-tw + source-hashes.json）一个 `settings.vault.*` 键都没有，靠 `src/lib/i18n.ts:98` `const template = activePack[key] ?? en[key];` 回退英文。
- `settings.simple.page.vault` 也只在 en.json / zh.json / zh-tw.json / source-hashes.json 出现。
- 空态「没有匹配的项目」是硬编码中文，未走 i18n。
- 隐私说明 en 逐字：`"Grok Bot never sees saved card numbers or security codes. It can see logins and contact info to fill them in for you."`

### 落地前必须先定义的安全边界

- 参考图/隐私说明明确「Grok Bot 永远看不到已保存卡片的卡号或安全码」；任何支付能力落地都要先定义
  加密存储、可见字段白名单与代填链路的边界（PCI 类），并保留「Bot 不可见卡号/CVV」这一不变量。
- 「联系信息」按原版语义应可被 Bot 读取以代填（与登录信息同级），需明确它与登录信息的权限模型是否共用。
- 因此 C 方案（补齐 payment/contact 真功能）**不在用户确认前落地**；B/D 属纯前端或视觉层，风险较低。

### 关联提交（builder 已做，供溯源；非本差异的修复）

- `f17f187` 2026-11-10 16:41 `feat: list and save vault logins without showing the password` —— 把原本 3 条写死假数据换成真实登录列表，并新增 `SimpleVaultPage.test.ts`。
- `6c641bd` 2026-11-10 16:48 `fix: keep saved usernames out of the model prompt`。
- `01f4c19` 2026-11-10 17:35 `fix: open the existing add-login form from the vault New item button` —— 给死按钮接上「添加登录信息」。
- 三者都只强化「登录信息」这一条能力线；支付/联系信息仍为空态。**笔记「目前只有登录信息 + 1Password」在 HEAD 上依旧成立**。

### 状态与复验

- 状态：**仍不做**（A 方案）。2026-11-11 只重对了上面的行号；支付/联系信息的数据和按钮都没接。
- 复验命令：
  `grep -n "tabPayments\|tabContacts\|contactBox\|没有匹配的项目" src/components/SettingsSimplePages.tsx`
  `grep -rn "LoginSource" shared/logins.ts`
  `grep -rl "tabPayments" src/locales/*.json`
  `git log -3 --oneline`
- 视觉复核：`reference/picture-7.png`（同源副本 `attachments/picture-7.png`）。
- craft.json 仍为 `status: "building"`、`note: "The builder checked its work: 1 of 2 checks pass."`；feed.json 32 项，末两条仍为同一句检查结论。

---

## 2026-11-11 · picture-1 到 picture-13

只记还能对上的产品行为。外形、间距、参考图里的示例文案不单列。创建 Bot、⌘K 搜索、通用页的账户/主题/语言、资料侧栏的头像生成与上传、资料库，当前都已有对应实现（`CommandPalette.tsx`、`ProfileSettings.tsx`、`src/components/bot-panel/AvatarEditorCard.tsx`、`LibraryTab.tsx`），这里不展开。

### picture-1 · 「你会什么」

参考图：简单模式聊天顶栏右侧深色胶囊，点开后是一段能力说明。

这次已接上。`src/components/ChatView.tsx:1099` 在简单模式顶栏渲染 `WhatICanDo`。面板用这个 bot 自己的 `description`、默认助手已有的 `helperIntro.lead.*` / `HELPER_ASK_KEYS`，以及当前引擎的 `displayName`（`src/components/WhatICanDo.tsx:38-71`）。没有 description、也不是默认助手、也没有引擎名时，显示 `chat.canDo.empty`。参考图里那组固定条目（查资料、写文案、写代码）没有数据源，没有写进面板。

### picture-5 · 电脑页

参考图：「在这台电脑上执行」「经此电脑转发流量」，以及「管理设备」里的本机和两台 Android；下面还有一条「你的电脑已是最新版本」。

管理设备这次已改。`ManagedDevicesList`（`src/components/SettingsSimplePages.tsx:189-228`）读 `/.well-known/openbot/environment` 的 `label`。这个 label 在 `server/environment.ts:167` 默认是 `hostname()`。读到名称就标在线；读不到就空态。`MacBook-Pro-3728.local`、`V2606A`、`V2606A (2)` 已从渲染里去掉。已配对的手机仍在 `PhoneDevicesSection`（`:294`）和 `/api/phones`（`src/lib/phones.ts:82`），没有再复制进这一列。

还没接上的两处：

- `ComputerExecutionRows`（`:149-179`）的执行下拉和流量开关只写在组件自己的 `useState` 里，刷新就回到「始终允许 / 开」。
- `:248-251` 的「你的电脑已是最新版本」不看更新检查结果，打开页面就会显示。

### picture-6 · 权限

参考图：自动审核开关；「始终询问」和「无需询问直接允许」各有「添加规则」。

自动审核开关原本就写入每个 bot 的 `approvalMode`，保留。每个 bot 的下拉也保留（`:434-459`）。

「无需询问直接允许」这次接到已有的命令允许名单。管理员且至少有一个 bot 时，按钮打开 `CommandAllowlistDialog`（`:406-409`、`:460`）；多个 bot 时先选 bot。名单的增删仍走 `/api/bots/:id/command-allowlist`。空名单用对话框里已有的 `commandAllowlist.empty`。

「始终询问」没有做。`shared/command-allowlist.ts` 只有「这条命令可以不经询问执行」。仓库里没有一份会让匹配操作停下来询问的规则存储。`:394-400` 只说明这一点，没有「添加规则」按钮，也没有写一条不会生效的规则。

### picture-8 · 更新

参考图：自动更新开关，以及当前版本和「检查更新」。

检查更新仍走已有的 `UpdatesRow` / `ServerUpdatesRow`（`:347`），版本号用 `appVersion()`。自动更新开关（`:331-345`）是本地 `useState(true)`，不写入更新设置。这次没改。

### picture-13 · 用量与账单

参考图：91% 已用、剩余 $3.75、购买额度、自动充值、当前计划 Premium。

假数字这次已从页面拿掉。有 Cloud 用量时用 `CloudUsageSummaryView`（`src/components/SettingsSimplePages.tsx:289`）；未登录或没有用量时是 `data-billing-empty`（`:291-293`），文案是已有的 `settings.simple.billing.ownAi` 和 `usageMeter.empty`。没有新的购买、充值或收款。账号未退出时，原来的 Cloud 账户区块还在（`:303-307`），里面的「管理」仍是已有的 `bridge.manage()`。`settings.billing.usedPercent` 等带 91%、$3.75、Premium 的词条已从 `en.json` / `zh.json` 删除。

各引擎自己的用量表仍是 `PlanUsageSummary`，只在没有 Cloud 用量、且当前是管理员时出现（`:296`）。没有把额度收成一份 Grok 账单。
