import { pageIsThisComputer } from "@/lib/companion-bridge";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Monitor, Search } from "lucide-react";
import { api, useStore, type AppSettingsSection } from "@/state/store";
import { approvalModeFor, type ApprovalMode } from "../../shared/approval-mode";
import { t } from "@/lib/i18n";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
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
import { CommandAllowlistDialog } from "./CommandAllowlistDialog";
import { AlwaysAskRules } from "./AlwaysAskRules";
import { ComputerExecutionRows, ComputerImageUpdates } from "./ComputerPolicyRows";
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

function computerLabel(value: unknown): string | null {
  if (!value || typeof value !== "object" || !("label" in value)) return null;
  const label = value.label;
  return typeof label === "string" && label.trim() ? label.trim() : null;
}

function ManagedDevicesList() {
  const [name, setName] = useState<string | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "empty">("loading");
  useEffect(() => {
    const controller = new AbortController();
    void api("/.well-known/openbot/environment", { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5_000)]) })
      .then((body: unknown) => {
        if (controller.signal.aborted) return;
        const label = computerLabel(body);
        if (!label) {
          setPhase("empty");
          return;
        }
        setName(label);
        setPhase("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setPhase("empty");
      });
    return () => controller.abort();
  }, []);

  if (phase === "loading") {
    return <p role="status" data-managed-devices="loading" className="text-[13px] text-ink-secondary">{t("settings.computer.devicesLoading")}</p>;
  }
  if (phase !== "ready" || !name) {
    return <p data-managed-devices="empty" className="text-[13px] text-ink-secondary">{t("settings.computer.devicesEmpty")}</p>;
  }
  return (
    <div data-managed-devices="this-computer" className="flex flex-col rounded-xl border border-ink/[0.08] bg-ink/[0.02]">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-ink/[0.06] text-ink-secondary">
          <Monitor size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium text-ink">{name}</div>
          <div className="flex items-center gap-1.5 text-[12px] text-ink-secondary">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            <span>{t("settings.computer.deviceComputer")} · {t("settings.computer.online")}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export type RemoteAccessCards = Record<"client" | "domain" | "pairing" | "companion", ReactNode>;

export function SimpleComputerPage({ has, remoteAccess, servers, disclose }: { has: Has; remoteAccess: RemoteAccessCards; servers: ReactNode; disclose: Disclose }) {
  return (
    <>
      {has("computer") && (
        <SettingsGroup label={t("settings.simple.computer.bots")} block="computer">
          <AdminOnly><ComputerImageUpdates /><LocalComputerSection /></AdminOnly>
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
      <div data-settings-block="usage" className="scroll-mt-4">
        {usage ? <CloudUsageSummaryView usage={usage} upgrade={upgrade}>{dialog}</CloudUsageSummaryView> : (
          <section data-billing-empty className="flex flex-col gap-2 rounded-xl border border-ink/[0.08] bg-ink/[0.02] p-4">
            <p className="text-[13px] leading-relaxed text-ink">{t("settings.simple.billing.ownAi")}</p>
            <p className="text-[13px] leading-relaxed text-ink-secondary">{t("usageMeter.empty")}</p>
          </section>
        )}
      </div>
      {!usage && <AdminOnly note="settings.adminOnly.usage"><PlanUsageSummary /></AdminOnly>}
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
  return (
    <div className="flex flex-col gap-4">
      <SettingsGroup label={t("settings.updates.grokBotUpdates")} block="updates">
        <SettingsRows>
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
  const ownerOrAdmin = useOwnerOrAdmin();
  const bots = state.bots.filter((bot) => !bot.hidden);
  const autoReview = bots.length > 0 && bots.every((bot) => permissionLevel(bot) !== "ask");
  const [allowlist, setAllowlist] = useState<{ botId: string; botName: string } | null>(null);
  const [pickingAllowlist, setPickingAllowlist] = useState(false);
  const setAll = (mode: "ask" | "auto") => {
    for (const bot of bots) dispatch({ type: "updateBot", botId: bot.id, patch: { approvalMode: mode, applyToAllThreads: true } });
  };
  const openAllowlist = () => {
    const [only] = bots;
    if (bots.length === 1 && only) {
      setAllowlist({ botId: only.id, botName: only.name });
      setPickingAllowlist(false);
      return;
    }
    setPickingAllowlist(true);
  };
  return (
    <div data-settings-block="permissions" className="flex scroll-mt-4 flex-col gap-6">
      <SettingsRows>
        <SettingRow title={t("settings.permissions.autoReview.title")} subtitle={t("settings.permissions.autoReview.subtitle")}>
          <Switch
            checked={autoReview}
            aria-label={t("settings.permissions.autoReview.title")}
            onClick={() => setAll(autoReview ? "ask" : "auto")}
          />
        </SettingRow>
      </SettingsRows>

      <SettingsRows>
        <AlwaysAskRules canManage={ownerOrAdmin === true} />
        <SettingRow
          title={t("settings.permissions.directAllow.title")}
          subtitle={t("settings.permissions.directAllow.subtitle")}
        >
          {ownerOrAdmin === true && bots.length > 0 ? (
            <button type="button" data-permission-allow-rule className="ui-button shrink-0" onClick={openAllowlist}>
              {t("settings.permissions.addRule")}
            </button>
          ) : bots.length === 0 ? (
            <span className="text-[13px] text-ink-secondary">{t("settings.permissions.noBots")}</span>
          ) : null}
        </SettingRow>
      </SettingsRows>
      {pickingAllowlist && bots.length > 1 && (
        <div role="group" aria-label={t("settings.permissions.directAllow.choose")} data-permission-allow-bots className="flex flex-col gap-1">
          {bots.map((bot) => (
            <button
              key={bot.id}
              type="button"
              data-permission-allow-bot={bot.id}
              className="rounded-lg px-3 py-2 text-left text-[13px] text-ink hover:bg-ink/[0.04]"
              onClick={() => {
                setAllowlist({ botId: bot.id, botName: bot.name });
                setPickingAllowlist(false);
              }}
            >
              {bot.name}
            </button>
          ))}
        </div>
      )}

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
      {allowlist && <CommandAllowlistDialog key={`command-allowlist:${allowlist.botId}`} {...allowlist} onClose={() => setAllowlist(null)} />}
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
