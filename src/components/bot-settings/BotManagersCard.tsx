import { useCallback, useEffect, useState } from "react";
import { t } from "../../lib/i18n";
import { api, ApiError } from "../../state/api";

type Candidate = { email: string; membershipId: string };
type Managers = { emails: string[]; revision: string; candidates: Candidate[] };
const accessDenied = (cause: unknown) => cause instanceof ApiError && (cause.status === 403 || cause.status === 404);

export function BotManagersCard({ botId, active = true }: { botId: string; active?: boolean }) {
  const [data, setData] = useState<Managers | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const path = `/api/bots/${encodeURIComponent(botId)}/managers`;

  const load = useCallback(async (signal?: AbortSignal) => {
    const result = await api<Managers>(path, { signal });
    if (signal?.aborted) return;
    setData(result);
    setSelected(result.emails);
  }, [path]);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    setData(null);
    setError(null);
    setNotice(null);
    void load(controller.signal).catch((cause: unknown) => {
      if (controller.signal.aborted || accessDenied(cause)) return;
      setError(cause instanceof Error ? cause.message : t("botManagers.loadError"));
    });
    return () => controller.abort();
  }, [active, load]);

  const save = async () => {
    if (!data || busy) return;
    const members = data.candidates.filter((candidate) => selected.includes(candidate.email));
    if (members.length !== selected.length) { setError(t("botManagers.membersChanged")); return; }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api(path, { method: "PUT", body: JSON.stringify({ members, expectedRevision: data.revision }) });
      await load();
      setNotice(t("botManagers.saved"));
    } catch (cause) {
      if (accessDenied(cause)) { setData(null); return; }
      if (cause instanceof ApiError && cause.status === 409) {
        try { await load(); setError(t("botManagers.conflict")); }
        catch (reloadError) {
          if (accessDenied(reloadError)) { setData(null); setError(null); }
          else setError(t("botManagers.loadError"));
        }
      } else setError(cause instanceof Error ? cause.message : t("botManagers.saveError"));
    } finally { setBusy(false); }
  };

  if (!active || (!data && !error)) return null;
  const changed = data !== null && (selected.length !== data.emails.length || selected.some((email) => !data.emails.includes(email)));
  return <section className="rounded-xl bg-card p-4" aria-label={t("botManagers.title")}>
    <h3 className="text-[15px] font-medium text-ink">{t("botManagers.title")}</h3>
    <p className="mt-1 text-[13px] text-ink-secondary">{t("botManagers.description")}</p>
    {error && <p role="alert" className="mt-2 text-[13px] text-danger">{error} <button type="button" className="underline" onClick={() => { setError(null); void load().catch((cause: unknown) => { if (accessDenied(cause)) { setData(null); setError(null); } else setError(cause instanceof Error ? cause.message : t("botManagers.loadError")); }); }}>{t("teamMemory.reload")}</button></p>}
    {notice && <p role="status" className="mt-2 text-[13px] text-ink-secondary">{notice}</p>}
    {data && <>
      {data.candidates.length === 0 ? <p className="mt-3 text-[13px] text-ink-secondary">{t("botManagers.empty")}</p> :
        <ul className="mt-3 space-y-2">{data.candidates.map((candidate) => <li key={candidate.membershipId}>
          <label className="flex items-center gap-2 text-[13px] text-ink"><input type="checkbox" disabled={busy} checked={selected.includes(candidate.email)} onChange={(event) => { const checked = event.target.checked; setSelected((current) => checked ? [...current, candidate.email] : current.filter((email) => email !== candidate.email)); }} />{candidate.email}</label>
        </li>)}</ul>}
      <button type="button" disabled={busy || !changed} className="mt-3 rounded-md bg-accent px-2.5 py-1 text-[13px] text-white disabled:opacity-50" onClick={() => void save()}>{t("common.save")}</button>
    </>}
  </section>;
}
