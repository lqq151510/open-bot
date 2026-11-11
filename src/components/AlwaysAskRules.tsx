import { useEffect, useId, useState, type FormEvent } from "react";
import { t } from "@/lib/i18n";
import { api } from "@/state/store";
import { ApiError } from "@/state/api";
import type { LocaleKey } from "@/locales";
import type { AlwaysAskRule as AskRule, AlwaysAskRuleScope as RuleScope, AlwaysAskRulesResponse } from "../../shared/always-ask-rules";
import { SettingRow } from "./SettingsPrimitives";

type DraftRule = AskRule & { scope: RuleScope };
type AskRules = Pick<AlwaysAskRulesResponse, "rules" | "semanticReview"> & Partial<AlwaysAskRulesResponse>;

const scopeLabels = {
  personal: "settings.permissions.alwaysAsk.personal",
  team: "settings.permissions.alwaysAsk.team",
} satisfies Record<RuleScope, LocaleKey>;

const rulesPath = "/api/permission-rules/always-ask";

export function AlwaysAskRules({ canManage }: { canManage: boolean }) {
  const [data, setData] = useState<AskRules | null>(null);
  const [retry, setRetry] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);
  const [edit, setEdit] = useState<DraftRule | null>(null);
  const [pending, setPending] = useState(false);
  const [saveError, setSaveError] = useState<LocaleKey | null>(null);
  const field = useId();

  useEffect(() => {
    const controller = new AbortController();
    void api<AskRules>(rulesPath, { signal: controller.signal }).then(
      (result) => {
        if (controller.signal.aborted) return;
        if (result && Array.isArray(result.rules)) setData(result);
        else setLoadFailed(true);
      },
      () => { if (!controller.signal.aborted) setLoadFailed(true); },
    );
    return () => controller.abort();
  }, [retry]);

  const scoped = Array.isArray(data?.personalRules) && Array.isArray(data?.teamRules);
  const groups = data ? [
    ...(scoped ? [{ scope: "personal" as const, rules: data.personalRules ?? [], editable: data.canEditPersonal === true }] : []),
    { scope: "team" as const, rules: data.teamRules ?? data.rules, editable: scoped ? data.canEditTeam === true : canManage },
  ] : [];

  const start = (rule: DraftRule) => {
    setSaveError(null);
    setEdit(rule);
  };

  async function save(method: "POST" | "PATCH" | "DELETE", rule: DraftRule) {
    setPending(true);
    setSaveError(null);
    try {
      const target = rule.id ? `${rulesPath}/${encodeURIComponent(rule.id)}` : rulesPath;
      const result = await api<AskRules>(scoped ? `${target}?scope=${rule.scope}` : target, {
        method,
        ...(method === "DELETE" ? {} : { body: JSON.stringify({ text: rule.text.trim() }) }),
      });
      if (!result || !Array.isArray(result.rules)) throw new Error("Invalid rules response");
      setData(result);
      setEdit(null);
    } catch (error) {
      setSaveError(error instanceof ApiError && error.body?.code === "always_ask_busy"
        ? "settings.permissions.alwaysAsk.busy" : "settings.permissions.alwaysAsk.saveFailed");
    } finally {
      setPending(false);
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!edit || !edit.text.trim() || pending) return;
    void save(edit.id ? "PATCH" : "POST", edit);
  };

  return (
    <div data-permission-always-ask>
      <SettingRow
        title={t("settings.permissions.alwaysAsk.title")}
        subtitle={t("settings.permissions.alwaysAsk.subtitle")}
        children={null}
      />
      {loadFailed && (
        <div role="alert" className="flex items-center gap-3 px-4 pb-3 text-[13px] text-ink-secondary">
          {t("settings.permissions.alwaysAsk.loadFailed")}
          <button type="button" className="ui-button"
            onClick={() => { setLoadFailed(false); setRetry((value) => value + 1); }}>
            {t("commandAllowlist.retry")}
          </button>
        </div>
      )}
      {!loadFailed && !data && (
        <p role="status" className="px-4 pb-3 text-[13px] text-ink-secondary">{t("commandAllowlist.loading")}</p>
      )}
      {data && (
        <div className="space-y-3 px-4 pb-3">
          {scoped && <p className="text-[12px] text-ink-secondary">{t("settings.permissions.alwaysAsk.scopeHint")}</p>}
          {!data.semanticReview && (edit || groups.some(({ rules }) => rules.some((rule) => !/^(tool|command):/i.test(rule.text)))) && (
            <p className="text-[12px] text-ink-secondary">{t("settings.permissions.alwaysAsk.manualFallback")}</p>
          )}
          {groups.map(({ scope, rules, editable }) => (
            <div key={scope} data-permission-ask-scope={scope} role="group" aria-label={t(scopeLabels[scope])} className="space-y-2">
              <div className="flex min-h-8 items-center justify-between gap-2">
                <span className="text-[13px] font-medium text-ink">{t(scopeLabels[scope])}</span>
                {editable && (
                  <button type="button" className="ui-button shrink-0" data-permission-ask-rule={scope}
                    disabled={pending || edit !== null} onClick={() => start({ scope, id: "", text: "" })}>
                    {t("settings.permissions.addRule")}
                  </button>
                )}
              </div>
              {rules.length === 0 && edit?.scope !== scope && (
                <p className="text-[13px] text-ink-secondary">{t("settings.permissions.alwaysAsk.none")}</p>
              )}
              {rules.length > 0 && (
                <ul className="space-y-1">
                  {rules.map((rule, index) => (
                    <li key={rule.id} className="flex items-center gap-2 rounded-lg bg-inset px-3 py-2">
                      <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[13px] text-ink">{rule.text}</span>
                      {editable && (
                        <>
                          <button type="button" className="ui-button" disabled={pending || edit !== null}
                            aria-label={t("settings.permissions.alwaysAsk.editNumber", { index: index + 1 })} onClick={() => start({ ...rule, scope })}>
                            {t("settings.permissions.alwaysAsk.edit")}
                          </button>
                          <button type="button" className="ui-button" disabled={pending || edit !== null}
                            aria-label={t("settings.permissions.alwaysAsk.deleteNumber", { index: index + 1 })} onClick={() => void save("DELETE", { ...rule, scope })}>
                            {t("common.delete")}
                          </button>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {edit?.scope === scope && editable && (
                <form onSubmit={submit} className="space-y-2 rounded-lg bg-inset p-3">
                  <label htmlFor={field} className="block text-[13px] text-ink">{t("settings.permissions.alwaysAsk.ruleText")}</label>
                  <textarea id={field} value={edit.text} maxLength={400} rows={3} disabled={pending}
                    onChange={(event) => setEdit({ ...edit, text: event.target.value })}
                    placeholder={t("settings.permissions.alwaysAsk.example")}
                    className="w-full resize-y rounded-md border border-ink/15 bg-raised px-2 py-1.5 text-[13px] text-ink" />
                  <div className="flex justify-end gap-2">
                    <button type="button" className="ui-button" disabled={pending}
                      onClick={() => { setEdit(null); setSaveError(null); }}>{t("common.cancel")}</button>
                    <button type="submit" className="ui-button" disabled={pending || !edit.text.trim()}>{t("common.save")}</button>
                  </div>
                </form>
              )}
            </div>
          ))}
          {saveError && <p role="alert" className="text-[13px] text-danger">{t(saveError)}</p>}
        </div>
      )}
    </div>
  );
}
