import { pageIsThisComputer } from "@/lib/companion-bridge";
import type { ReactNode } from "react";
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
import { ProfileSummaryRow } from "./ProfileSettings";
import { ImportSettings } from "./ImportSettings";
import { NotificationRows } from "./NotificationSettingsRows";
import { useServerUpdateItem } from "./SidebarProfileMenu";
import { AdvancedModeRow, BrowserProfilesRow, ColorUserBubblesRow, FollowUpRow, LanguageRow, ReplayTourRow, SendKeyRow, SpellCheckRow, UpdatesRow } from "./AppSettingsRows";
import { ThemeRow } from "./ThemeRow";
import { AccentRow } from "./AccentRow";
import { MicrophoneRow } from "./MicrophoneRow";
import { AdminOnly } from "./AdminOnly";

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
            <PlaceLookRows />
            <ChromeRailRow />
            <WindowFrameRow />
            <ColorUserBubblesRow simple />
            <LanguageRow simple />
            <SpellCheckRow />
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

export type RemoteAccessCards = Record<"client" | "domain" | "pairing" | "companion", ReactNode>;

export function SimpleComputerPage({ has, remoteAccess, servers, disclose }: { has: Has; remoteAccess: RemoteAccessCards; servers: ReactNode; disclose: Disclose }) {
  return (
    <>
      {has("computer") && <SettingsGroup label={t("settings.simple.computer.bots")} block="computer"><AdminOnly><LocalComputerSection /></AdminOnly></SettingsGroup>}
      {has("companion") && (
        <SettingsGroup label={t(pageIsThisComputer() ? "settings.section.phoneDevices" : "settings.section.thisServer")} block="companion">
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
    <>
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
    </>
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
    <SettingsGroup block="updates">
      <SettingsRows>
        {window.ogb?.updater ? <UpdatesRow title={versionTitle()} /> : <ServerUpdatesRow />}
        <UpdatesConsentRow />
        {!remoteActive && <ReplayTourRow />}
        <DiagnosticsRow simple />
      </SettingsRows>
    </SettingsGroup>
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
    <div data-settings-block="permissions" className="flex scroll-mt-4 flex-col gap-7">
      <SettingsRows>
        <SettingRow title={t("settings.permissions.autoReview.title")} subtitle={t("settings.permissions.autoReview.subtitle")}>
          <Switch
            checked={autoReview}
            aria-label={t("settings.permissions.autoReview.title")}
            onChange={() => setAll(autoReview ? "ask" : "auto")}
          />
        </SettingRow>
      </SettingsRows>
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
          {bots.length === 0 && <div className="px-4 py-2 text-[13px] text-ink-secondary">{t("settings.permissions.noBots")}</div>}
        </SettingsRows>
      </SettingsGroup>
    </div>
  );
}
