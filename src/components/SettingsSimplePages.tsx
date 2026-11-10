import { pageIsThisComputer } from "@/lib/companion-bridge";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { CheckCircle2, ExternalLink, Monitor, Search, Smartphone } from "lucide-react";
import { useStore, type AppSettingsSection } from "@/state/store";
import { approvalModeFor, type ApprovalMode } from "../../shared/approval-mode";
import { t } from "@/lib/i18n";
import { appVersion } from "@/lib/app-links";
import type { LocaleKey } from "@/locales";
import { productName } from "../lib/brand";
import { AnalyticsRow } from "./AnalyticsRow";
import { UpdatesConsentRow } from "./UpdatesConsent";
import { OpenAtLoginRow } from "./OpenAtLoginRow";
import { DefaultBotSidebarRow } from "./DefaultBotControls";
import { TalkShortcutRow } from "./TalkShortcutRow";
import { AttachmentStorageSettings } from "./AttachmentStorageSettings";
import { DiagnosticsRow } from "./DiagnosticsRow";
import { EnginesSettings } from "./EnginesSettings";
import { LocalComputerSection } from "./LocalComputerSection";
import { PeopleSection } from "./PeopleSection";
import { ActivitySection } from "./ActivitySection";
import { BuiltInBrowserRow, ServerSitesRow } from "./BrowserSettingsRows";
import { OrganizationSettings } from "./OrganizationSettings";
import { CloudPlanRow, CloudPlanFootnote, useCloudPlan } from "./ProIntroduction";
import { CloudUsageDetails, CloudUsageSummaryView, useCloudUsageSettings } from "./CloudUsageMeter";
import { SettingRow, SettingsDisclosureRow, SettingsGroup, SettingsRows, Switch } from "./SettingsPrimitives";
import { BotAvatar } from "./Avatar";
import { Select } from "./Select";
import { UsageSection } from "./UsageSection";
import { PlanUsageSummary } from "./PlanUsage";
import { SkinPicker } from "./SkinPicker";
import { PlaceLookRows } from "./PlaceLookCard";
import { ChromeRailRow } from "./ChromeRailToggle";
import { WindowFrameRow } from "./WindowFrameRow";
import { HardwareAccelerationRow } from "./HardwareAccelerationRow";
import { ProfileSummaryRow } from "./ProfileSettings";
import { ImportSettings } from "./ImportSettings";
import { NotificationRows } from "./NotificationSettingsRows";
import { useServerUpdateItem } from "./SidebarProfileMenu";
import { AdvancedModeRow, BrowserProfilesRow, ColorUserBubblesRow, FollowUpRow, LanguageRow, ReplayTourRow, SendKeyRow, SpellCheckRow, UpdatesRow } from "./AppSettingsRows";
import { ThemeRow } from "./ThemeRow";
import { AccentRow } from "./AccentRow";
import { MicrophoneRow } from "./MicrophoneRow";
import { AdminOnly } from "./AdminOnly";
import { LoginsSettings } from "./LoginsSettings";

export type SimpleDisclosureId = "ai-more" | "ai-keys" | "computer-elsewhere" | "billing-limits";

export type Disclose = (id: SimpleDisclosureId) => { id: SimpleDisclosureId; open: boolean; onToggle: () => void };

export const SIMPLE_ADVANCED_ONLY: readonly LocaleKey[] = [
  "settings.newBotEffort.title", "newBot.defaults", "settings.roomTurns.title", "settings.mcpCalls.title", "settings.threads.title",
  "settings.recovery.title", "settings.threadCleanup.title", "settings.font.title", "settings.chatWidth.title",
  "settings.pinnedCircles.title", "settings.universalPins.title", "settings.toolCalls.title", "settings.runCard.title", "settings.keepWarm.title",
];

type Has = (id: AppSettingsSection) => boolean;

export function SimpleGeneralPage({ has, peopleOpen, onLooks, ai, botAccess }: { has: Has; peopleOpen: boolean; onLooks: () => void; ai: ReactNode; botAccess: ReactNode }) {
  return (
    <>
      {(has("general") || has("people")) && (
        <SettingsGroup label={t("settings.group.account")} block="general">
          <SettingsRows>
            {has("general") && <ProfileSummaryRow />}
            {has("general") && <CloudPlanRow place="account" />}
            {has("people") && <div data-settings-block="people" className="scroll-mt-4"><PeopleSection simple startOpen={peopleOpen} /></div>}
          </SettingsRows>
        </SettingsGroup>
      )}
      {has("appearance") && (
        <SettingsGroup label={t("settings.section.appearance")} block="appearance">
          <SettingsRows>
            <ThemeRow simple />
            <AccentRow />
            <LanguageRow simple />
            <SpellCheckRow />
            <PlaceLookRows />
            <ChromeRailRow />
            <WindowFrameRow />
            <ColorUserBubblesRow simple />
            <SendKeyRow simple />
            <FollowUpRow simple />
            <SettingRow title={t("settings.simple.looks.title")}>
              <button type="button" className="ui-button" onClick={onLooks}>{t("settings.simple.looks.change")}</button>
            </SettingRow>
          </SettingsRows>
        </SettingsGroup>
      )}
      {has("general") && (
        <SettingsGroup label={t("settings.simple.group.system")}>
          <SettingsRows>
            <MicrophoneRow />
            <HardwareAccelerationRow />
            <OpenAtLoginRow simple />
            <DefaultBotSidebarRow simple />
            <TalkShortcutRow />
            <AttachmentStorageSettings />
            <AnalyticsRow simple />
          </SettingsRows>
        </SettingsGroup>
      )}
      {has("appearance") && (
        <SettingsGroup label={t("notifications.title")}>
          <SettingsRows><NotificationRows simple /></SettingsRows>
        </SettingsGroup>
      )}
      {(has("engines") || has("connections") || has("botAccess")) && (
        <SettingsGroup label={t("settings.simple.group.bot")} block="bot">
          {has("botAccess") && <div data-settings-block="botAccess" className="flex scroll-mt-4 flex-col gap-4">{botAccess}</div>}
          {ai}
        </SettingsGroup>
      )}
      {has("import") && <SettingsGroup label={t("settings.section.import")} block="import"><AdminOnly><ImportSettings /></AdminOnly></SettingsGroup>}
      {has("organization") && <SettingsGroup label={t("settings.section.organization")} block="organization"><OrganizationSettings /></SettingsGroup>}
      {has("activity") && <SettingsGroup label={t("settings.section.activity")} block="activity"><ActivitySection /></SettingsGroup>}
      <div data-settings-block="advanced-mode" className="scroll-mt-4">
        <SettingsRows><AdvancedModeRow simple /></SettingsRows>
      </div>
    </>
  );
}

export function SimpleLooksPage({ onBack }: { onBack: () => void }) {
  return (
    <>
      <div><button type="button" className="ui-button" onClick={onBack}>{t("settings.simple.looks.back")}</button></div>
      <div data-settings-block="looks"><SkinPicker /></div>
    </>
  );
}

export function SimpleAiPage({ has, disclose, connections }: { has: Has; disclose: Disclose; connections: ReactNode }) {
  return (
    <>
      {has("engines") && <div data-settings-block="engines" className="flex scroll-mt-4 flex-col gap-7"><AdminOnly><EnginesSettings simple more={disclose("ai-more")} /></AdminOnly></div>}
      {has("connections") && (
        <AdminOnly>
          <SettingsDisclosureRow title={t("settings.section.connections")} block="connections" {...disclose("ai-keys")}>
            {connections}
          </SettingsDisclosureRow>
        </AdminOnly>
      )}
    </>
  );
}

function ComputerExecutionRows() {
  const [execPermission, setExecPermission] = useState("always");
  const [forwardTraffic, setForwardTraffic] = useState(true);

  return (
    <SettingsRows>
      <SettingRow
        title={t("settings.computer.executeOnThis")}
        subtitle={t("settings.computer.executeOnThisSubtitle")}
      >
        <Select
          size="sm"
          value={execPermission}
          onChange={(e) => setExecPermission(e.target.value)}
          aria-label={t("settings.computer.executeOnThis")}
        >
          <option value="always">{t("settings.computer.alwaysAllow")}</option>
          <option value="ask">{t("settings.computer.askEveryTime")}</option>
        </Select>
      </SettingRow>
      <SettingRow
        title={t("settings.computer.forwardTraffic")}
        subtitle={t("settings.computer.forwardTrafficSubtitle")}
      >
        <Switch
          checked={forwardTraffic}
          aria-label={t("settings.computer.forwardTraffic")}
          onChange={() => setForwardTraffic(!forwardTraffic)}
        />
      </SettingRow>
    </SettingsRows>
  );
}

function ManagedDevicesList() {
  const devices = [
    {
      id: "macbook",
      icon: Monitor,
      title: "MacBook-Pro-3728.local",
      statusText: `${t("settings.computer.deviceComputer")} · ${t("settings.computer.online")}`,
      online: true,
    },
    {
      id: "android-1",
      icon: Smartphone,
      title: "V2606A",
      statusText: "Android · 上次打开：4天前",
      online: false,
    },
    {
      id: "android-2",
      icon: Smartphone,
      title: "V2606A (2)",
      statusText: "Android · 上次打开：上周",
      online: false,
    },
  ];

  return (
    <div className="flex flex-col rounded-xl border border-ink/[0.08] bg-ink/[0.02] divide-y divide-ink/[0.06]">
      {devices.map((device) => {
        const Icon = device.icon;
        return (
          <div key={device.id} className="flex items-center gap-3 px-3 py-2.5">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-ink/[0.06] text-ink-secondary">
              <Icon size={16} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium text-ink">{device.title}</div>
              <div className="flex items-center gap-1.5 text-[12px] text-ink-secondary">
                <span className={`size-1.5 rounded-full ${device.online ? "bg-emerald-500" : "bg-ink-secondary/50"}`} />
                <span>{device.statusText}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export type RemoteAccessCards = Record<"client" | "domain" | "pairing" | "companion", ReactNode>;

export function SimpleComputerPage({ has, remoteAccess, servers, disclose }: { has: Has; remoteAccess: RemoteAccessCards; servers: ReactNode; disclose: Disclose }) {
  return (
    <>
      {has("computer") && (
        <SettingsGroup label={t("settings.simple.computer.bots")} block="computer">
          <div className="flex flex-col gap-2 rounded-xl border border-ink/[0.08] bg-ink/[0.02] p-4 mb-2">
            <div className="text-[14px] font-medium text-ink">{t("settings.computer.updateBotsComputer")}</div>
            <div className="text-[13px] leading-relaxed text-ink-secondary">
              {t("settings.computer.updateBotsComputerSubtitle")}
            </div>
            <div className="mt-1 flex items-center gap-2 rounded-lg bg-blue-500/10 px-3 py-2 text-[13px] font-medium text-blue-600 dark:text-blue-400">
              <CheckCircle2 size={16} className="shrink-0" />
              <span>{t("settings.computer.upToDate")}</span>
            </div>
          </div>
          <AdminOnly><LocalComputerSection /></AdminOnly>
        </SettingsGroup>
      )}
      {has("companion") && (
        <SettingsGroup label={t(pageIsThisComputer() ? "settings.section.phoneDevices" : "settings.section.thisServer")} block="companion">
          <ComputerExecutionRows />
          <div className="mt-3">
            <ManagedDevicesList />
          </div>
          {remoteAccess.companion}
          {remoteAccess.pairing}
          {remoteAccess.domain}
        </SettingsGroup>
      )}
      {has("computer") && (
        <SettingsGroup label={t("settings.experimental.browser")} block="browser">
          <SettingsRows><BuiltInBrowserRow /><ServerSitesRow /></SettingsRows>
          <BrowserProfilesRow />
        </SettingsGroup>
      )}
      {(has("companion") || has("desktopWorkspaces")) && (
        <SettingsDisclosureRow title={t("settings.simple.computer.elsewhere")} block="elsewhere" {...disclose("computer-elsewhere")}>
          {has("desktopWorkspaces") && <div data-settings-block="desktopWorkspaces" className="flex scroll-mt-4 flex-col gap-4">{servers}</div>}
          {has("companion") && <div data-settings-block="remote" className="flex scroll-mt-4 flex-col gap-4 empty:hidden">{remoteAccess.client}</div>}
        </SettingsDisclosureRow>
      )}
    </>
  );
}

export function SimpleBillingPage({ has, disclose, cloudAccount }: { has: Has; disclose: Disclose; cloudAccount: ReactNode }) {
  const { usage, upgrade, dialog } = useCloudUsageSettings();
  const plan = useCloudPlan();
  const signedOut = plan?.view.kind === "signed-out" || plan?.view.kind === "removed";
  return (
    <div className="flex flex-col gap-5">
      {/* 每周用量限额卡片 */}
      <div className="flex flex-col gap-2 rounded-xl border border-ink/[0.08] bg-ink/[0.02] p-4">
        <div className="text-[13px] font-medium text-ink">{t("settings.billing.weeklyLimit")}</div>
        <div className="text-[26px] font-semibold text-ink tracking-tight mt-1">
          {t("settings.billing.usedPercent")}
        </div>
        <div className="h-1.5 w-full bg-ink/[0.08] rounded-full overflow-hidden my-1">
          <div className="h-full bg-blue-500 rounded-full w-[91%]" />
        </div>
        <div className="text-[13px] text-ink-secondary">{t("settings.billing.resetsIn")}</div>
        <div className="text-[12px] text-ink-secondary/80 mt-1 border-t border-ink/[0.06] pt-2">
          {t("settings.billing.weeklySubtitle")}
        </div>
      </div>

      {/* 用量上限重置卡片 */}
      <div className="flex flex-col gap-1.5 rounded-xl border border-ink/[0.08] bg-ink/[0.02] p-4">
        <div className="text-[13px] font-medium text-ink">{t("settings.billing.limitResets")}</div>
        <div className="text-[13px] text-ink-secondary mt-1">{t("settings.billing.noResets")}</div>
      </div>

      {/* 额外用量额度卡片 */}
      <div className="flex flex-col gap-3 rounded-xl border border-ink/[0.08] bg-ink/[0.02] p-4">
        <div className="flex items-center justify-between">
          <div className="text-[13px] font-medium text-ink">{t("settings.billing.extraCredits")}</div>
          <div className="flex items-center gap-2">
            <button type="button" className="rounded-full bg-blue-500/10 px-3 py-1 text-[12px] font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 transition-colors">
              {t("settings.billing.buyCredits")}
            </button>
            <button type="button" className="rounded-full bg-ink px-3 py-1 text-[12px] font-medium text-canvas hover:bg-ink/90 transition-colors">
              {t("settings.billing.autoRecharge")}
            </button>
          </div>
        </div>
        <div className="text-[26px] font-semibold text-ink tracking-tight mt-0.5">
          {t("settings.billing.remainingBalance")}
        </div>
        <div className="flex flex-col gap-1.5 text-[13px] border-t border-ink/[0.06] pt-2.5">
          <div className="flex items-center justify-between">
            <span className="text-ink-secondary">{t("settings.billing.monthlyExtraUsage")}</span>
            <span className="font-medium text-ink">$3.91</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-ink-secondary">{t("settings.billing.monthlyExtraLimit")}</span>
            <span className="text-ink"><span className="font-medium">$10.00</span> · <span className="text-blue-500 hover:underline cursor-pointer">编辑</span></span>
          </div>
        </div>
        <div className="text-[12px] text-ink-secondary/80">
          {t("settings.billing.creditsExpiry")}
        </div>
      </div>

      {/* 管理计划卡片 */}
      <div className="flex flex-col gap-2 rounded-xl border border-ink/[0.08] bg-ink/[0.02] p-4 divide-y divide-ink/[0.06]">
        <div className="flex items-center justify-between pb-3">
          <div>
            <div className="text-[14px] font-medium text-ink">{t("settings.billing.currentPlan")}</div>
            <div className="text-[13px] text-ink-secondary">{t("settings.billing.cursorManage")}</div>
          </div>
          <button type="button" className="ui-button flex items-center gap-1.5 shrink-0 text-[13px]">
            {t("settings.billing.managePlan")} <ExternalLink size={13} />
          </button>
        </div>
        <div className="flex items-center justify-between pt-3">
          <div className="text-[14px] font-medium text-ink">{t("settings.billing.manageBilling")}</div>
          <button type="button" className="ui-button flex items-center gap-1.5 shrink-0 text-[13px]">
            {t("settings.billing.manageBilling")} <ExternalLink size={13} />
          </button>
        </div>
      </div>

      <div data-settings-block="usage" className="scroll-mt-4">
        {usage ? <CloudUsageSummaryView usage={usage} upgrade={upgrade}>{dialog}</CloudUsageSummaryView> : <AdminOnly note="settings.adminOnly.usage"><PlanUsageSummary /></AdminOnly>}
      </div>
      {(usage || has("usage")) && (
        <SettingsDisclosureRow title={t("settings.simple.billing.limits")} {...disclose("billing-limits")}>
          {usage && <CloudUsageDetails usage={usage} upgrade={upgrade} />}
          {has("usage") && <AdminOnly note="settings.adminOnly.usage"><UsageSection /></AdminOnly>}
        </SettingsDisclosureRow>
      )}
      {has("cloudAccount") && (
        <SettingsGroup label={t("settings.simple.billing.plan")} block="cloudAccount" footnote={<CloudPlanFootnote />}>
          <SettingsRows><CloudPlanRow place="plan" usage={usage} upgrade={upgrade} /></SettingsRows>
          {signedOut ? null : <div className="flex flex-col gap-4">{cloudAccount}</div>}
        </SettingsGroup>
      )}
    </div>
  );
}

const versionTitle = () => `${productName()} ${appVersion()}`;

function ServerUpdatesRow() {
  const entry = useServerUpdateItem(true);
  if (!entry) return null;
  const status = entry.phase === "idle" ? undefined : [entry.label, entry.item.subtitle].filter(Boolean).join(" ");
  const action = entry.phase === "available" ? t("settings.simple.updates.seeRelease")
    : entry.phase === "reload" ? t("settings.simple.updates.reload")
      : entry.phase === "checking" ? t("common.checking") : t("settings.updates.check");
  return (
    <SettingRow title={versionTitle()} subtitle={status}>
      <button type="button" className="ui-button" disabled={entry.item.disabled} onClick={entry.item.onSelect}>{action}</button>
    </SettingRow>
  );
}

export function SimpleUpdatesPage({ remoteActive }: { remoteActive: boolean }) {
  const [autoUpdate, setAutoUpdate] = useState(true);

  return (
    <div className="flex flex-col gap-4">
      <SettingsGroup label={t("settings.updates.grokBotUpdates")} block="updates">
        <SettingsRows>
          <SettingRow
            title={t("settings.updates.autoUpdate")}
            subtitle={t("settings.updates.autoUpdateSubtitle")}
          >
            <Switch
              checked={autoUpdate}
              aria-label={t("settings.updates.autoUpdate")}
              onChange={() => setAutoUpdate(!autoUpdate)}
            />
          </SettingRow>
          {window.ogb?.updater ? <UpdatesRow title={versionTitle()} /> : <ServerUpdatesRow />}
          <UpdatesConsentRow />
          {!remoteActive && <ReplayTourRow />}
          <DiagnosticsRow simple />
        </SettingsRows>
      </SettingsGroup>
    </div>
  );
}

const permissionLevel = (bot: Parameters<typeof approvalModeFor>[0]): "ask" | "auto" | "full" => {
  const mode = approvalModeFor(bot);
  return mode === "ask" || mode === "edits" ? "ask" : mode === "auto" ? "auto" : "full";
};

export function SimplePermissionsPage() {
  const { state, dispatch } = useStore();
  const bots = state.bots.filter((bot) => !bot.hidden);
  const autoReview = bots.length > 0 && bots.every((bot) => permissionLevel(bot) !== "ask");
  const setAll = (mode: "ask" | "auto") => {
    for (const bot of bots) dispatch({ type: "updateBot", botId: bot.id, patch: { approvalMode: mode, applyToAllThreads: true } });
  };
  return (
    <div data-settings-block="permissions" className="flex scroll-mt-4 flex-col gap-6">
      <SettingsRows>
        <SettingRow title={t("settings.permissions.autoReview.title")} subtitle={t("settings.permissions.autoReview.subtitle")}>
          <Switch
            checked={autoReview}
            aria-label={t("settings.permissions.autoReview.title")}
            onChange={() => setAll(autoReview ? "ask" : "auto")}
          />
        </SettingRow>
      </SettingsRows>

      <SettingsRows>
        <SettingRow
          title={t("settings.permissions.alwaysAsk.title")}
          subtitle={t("settings.permissions.alwaysAsk.subtitle")}
        >
          <button type="button" className="ui-button shrink-0">
            {t("settings.permissions.addRule")}
          </button>
        </SettingRow>
        <SettingRow
          title={t("settings.permissions.directAllow.title")}
          subtitle={t("settings.permissions.directAllow.subtitle")}
        >
          <button type="button" className="ui-button shrink-0">
            {t("settings.permissions.addRule")}
          </button>
        </SettingRow>
      </SettingsRows>

      {bots.length > 0 && (
        <SettingsGroup label={t("settings.permissions.modes.title")} footnote={t("settings.permissions.modes.subtitle")}>
          <SettingsRows>
            {bots.map((bot) => (
              <div key={bot.id} data-permission-bot={bot.id} className="flex items-center gap-3 px-4 py-2">
                <BotAvatar bot={bot} size={28} />
                <span className="min-w-0 flex-1 truncate text-[14px] leading-5 text-ink">{bot.name}</span>
                <Select
                  size="sm"
                  variant="ghost"
                  value={permissionLevel(bot)}
                  aria-label={t("settings.permissions.botAria", { name: bot.name })}
                  onChange={(event) => dispatch({
                    type: "updateBot",
                    botId: bot.id,
                    patch: { approvalMode: event.target.value as ApprovalMode, applyToAllThreads: true },
                  })}
                >
                  <option value="ask">{t("settings.permissions.alwaysAsk")}</option>
                  <option value="auto">{t("settings.permissions.auto")}</option>
                  <option value="full">{t("settings.permissions.full")}</option>
                </Select>
              </div>
            ))}
          </SettingsRows>
        </SettingsGroup>
      )}
    </div>
  );
}

export function SimpleVaultPage({ onReady }: { onReady?: (open: () => void) => void } = {}) {
  const [tab, setTab] = useState<"all" | "logins" | "payments" | "contacts">("all");
  const [search, setSearch] = useState("");
  const [loginCount, setLoginCount] = useState(0);
  const [openAdd, setOpenAdd] = useState(0);
  const openLoginForm = useCallback(() => {
    setTab((current) => (current === "all" || current === "logins" ? current : "logins"));
    setOpenAdd((count) => count + 1);
  }, []);
  useEffect(() => {
    onReady?.(openLoginForm);
    return () => { onReady?.(() => {}); };
  }, [onReady, openLoginForm]);

  const showLogins = tab === "all" || tab === "logins";
  const contactBox = tab === "payments" || tab === "contacts";
  const tabClass = (id: typeof tab) => `rounded-full px-3 py-1 font-medium transition-colors ${tab === id ? "bg-ink/[0.08] text-ink" : "text-ink-secondary hover:text-ink"}`;

  return (
    <div data-settings-block="logins" className="flex scroll-mt-4 flex-col gap-4">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 overflow-x-auto text-[13px]">
            <button type="button" data-vault-tab="all" onClick={() => setTab("all")} className={tabClass("all")}>
              {t("settings.vault.tabAll")} {loginCount}
            </button>
            <button type="button" data-vault-tab="logins" onClick={() => setTab("logins")} className={tabClass("logins")}>
              {t("settings.vault.tabLogins")} {loginCount}
            </button>
            <button type="button" data-vault-tab="payments" onClick={() => setTab("payments")} className={tabClass("payments")}>
              {t("settings.vault.tabPayments")} 0
            </button>
            <button type="button" data-vault-tab="contacts" onClick={() => setTab("contacts")} className={tabClass("contacts")}>
              {t("settings.vault.tabContacts")} 0
            </button>
          </div>
          <div className="relative flex items-center">
            <Search size={14} className="absolute left-2.5 text-ink-secondary pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("settings.vault.search")}
              className="h-8 w-44 rounded-full border border-ink/[0.08] bg-ink/[0.03] pl-8 pr-3 text-[13px] text-ink placeholder:text-ink-secondary focus:outline-none focus:ring-1 focus:ring-ink/20"
            />
          </div>
        </div>

        {contactBox && (
          <div className="overflow-hidden rounded-xl border border-ink/[0.08] bg-ink/[0.02]">
            <div className="p-4 text-center text-[13px] text-ink-secondary">
              没有匹配的项目
            </div>
          </div>
        )}

        {showLogins && <LoginsSettings query={search} onListed={setLoginCount} openAdd={openAdd} />}

        <p className="text-[12px] leading-relaxed text-ink-secondary px-1">
          {t("settings.vault.privacyNote")}
        </p>
      </div>
    </div>
  );
}
