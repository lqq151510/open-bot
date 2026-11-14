import { useCallback, useEffect, useState } from "react";
import { t } from "../../lib/i18n";
import { api, ApiError } from "../../state/api";

type LearningKind = "person" | "place" | "decision" | "term";
type Learning = { id: string; kind: LearningKind; name: string; detail: string; state: "proposed" | "accepted" | "rejected"; revision: number };
type Capabilities = { canPropose: boolean; canReview: boolean };

export function BotLearningsCard({ botId, active = true }: { botId: string; active?: boolean }) {
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [entries, setEntries] = useState<Learning[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [kind, setKind] = useState<LearningKind>("term");
  const [name, setName] = useState("");
  const [detail, setDetail] = useState("");
  const base = `/api/bots/${encodeURIComponent(botId)}`;

  const load = useCallback(async (signal?: AbortSignal) => {
    const access = await api<Capabilities>(`${base}/learning-capabilities`, { signal });
    const result = access.canReview ? await api<{ entries: Learning[] }>(`${base}/learnings`, { signal }) : null;
    if (signal?.aborted) return;
    setCapabilities(access);
    setEntries(result?.entries ?? []);
    setError(null);
  }, [base]);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    setCapabilities(null);
    setEntries(null);
    setError(null);
    void load(controller.signal).catch((cause: unknown) => {
      if (controller.signal.aborted || (cause instanceof ApiError && cause.status === 404)) return;
      setError(cause instanceof Error ? cause.message : t("botLearnings.loadError"));
    });
    return () => controller.abort();
  }, [active, load]);

  const submit = async () => {
    if (busy || !name.trim() || !detail.trim()) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api(`${base}/learnings`, { method: "POST", body: JSON.stringify({ explicitlyShared: true, learning: { kind, name: name.trim(), detail: detail.trim() } }) });
      setName("");
      setDetail("");
      setNotice(t("botLearnings.submitted"));
      if (capabilities?.canReview) await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("botLearnings.saveError"));
    } finally { setBusy(false); }
  };

  const decide = async (entry: Learning, action: "accept" | "reject") => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api(`${base}/learnings/${encodeURIComponent(entry.id)}`, { method: "PATCH", body: JSON.stringify({ revision: entry.revision, action }) });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("botLearnings.saveError"));
      if (cause instanceof ApiError && cause.status === 409) {
        try {
          const result = await api<{ entries: Learning[] }>(`${base}/learnings`);
          setEntries(result.entries);
        } catch { setError(cause.message); }
      }
    } finally { setBusy(false); }
  };

  if (!active || (!capabilities && !error)) return null;
  if (capabilities && !capabilities.canPropose && !capabilities.canReview) return null;
  const proposed = (entries ?? []).filter((entry) => entry.state === "proposed");
  const accepted = (entries ?? []).filter((entry) => entry.state === "accepted");
  return (
    <section className="rounded-xl bg-card p-4" aria-label={t("botLearnings.title")}>
      <h3 className="text-[15px] font-medium text-ink">{t("botLearnings.title")}</h3>
      <p className="mt-1 text-[13px] text-ink-secondary">{t("botLearnings.description")}</p>
      {error && <p role="alert" className="mt-2 text-[13px] text-danger">{error} <button type="button" className="underline" onClick={() => void load().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : t("botLearnings.loadError")))}>{t("teamMemory.reload")}</button></p>}
      {notice && <p role="status" className="mt-2 text-[13px] text-ink-secondary">{notice}</p>}
      {capabilities?.canReview && <div className="mt-3">
        <h4 className="text-[13px] font-medium text-ink">{t("botLearnings.pending")}</h4>
        {entries === null ? <p className="mt-2 text-[13px] text-ink-secondary">{t("common.checking")}</p> : proposed.length === 0 ? <p className="mt-2 text-[13px] text-ink-secondary">{t("botLearnings.empty")}</p> :
          <ul className="mt-2 space-y-2">{proposed.map((entry) => <li key={entry.id} className="rounded-lg bg-inset p-3 text-[13px]">
            <p className="font-medium text-ink">{entry.name}</p><p className="mt-1 whitespace-pre-wrap break-words text-ink-secondary">{entry.detail}</p>
            <div className="mt-2 flex gap-2"><button type="button" disabled={busy} className="rounded-md bg-accent px-2.5 py-1 text-white disabled:opacity-50" onClick={() => void decide(entry, "accept")}>{t("botLearnings.accept")}</button><button type="button" disabled={busy} className="rounded-md px-2.5 py-1 text-ink-secondary hover:bg-control disabled:opacity-50" onClick={() => void decide(entry, "reject")}>{t("botLearnings.reject")}</button></div>
          </li>)}</ul>}
      </div>}
      {capabilities?.canReview && accepted.length > 0 && <div className="mt-3">
        <h4 className="text-[13px] font-medium text-ink">{t("botLearnings.approved")}</h4>
        <ul className="mt-2 space-y-2">{accepted.map((entry) => <li key={entry.id} className="rounded-lg bg-inset p-3 text-[13px]">
          <p className="font-medium text-ink">{entry.name}</p><p className="mt-1 whitespace-pre-wrap break-words text-ink-secondary">{entry.detail}</p>
          <button type="button" disabled={busy} className="mt-2 rounded-md px-2.5 py-1 text-ink-secondary hover:bg-control disabled:opacity-50" onClick={() => void decide(entry, "reject")}>{t("botLearnings.revoke")}</button>
        </li>)}</ul>
      </div>}
      {capabilities?.canPropose && <form className="mt-3 space-y-2" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <h4 className="text-[13px] font-medium text-ink">{t("botLearnings.propose")}</h4>
        <select aria-label={t("teamMemory.kindLabel")} value={kind} onChange={(event) => setKind(event.target.value as LearningKind)} className="w-full rounded-lg border border-hairline/40 bg-inset px-2 py-1.5 text-[13px] text-ink">
          {(["term", "person", "place", "decision"] as const).map((value) => <option key={value} value={value}>{t(`teamMemory.kind.${value}`)}</option>)}
        </select>
        <input aria-label={t("teamMemory.nameLabel")} placeholder={t("teamMemory.namePlaceholder")} maxLength={120} value={name} onChange={(event) => setName(event.target.value)} className="w-full rounded-lg border border-hairline/40 bg-inset px-2 py-1.5 text-[13px] text-ink" />
        <textarea aria-label={t("teamMemory.detailLabel")} placeholder={t("teamMemory.detailPlaceholder")} maxLength={600} value={detail} onChange={(event) => setDetail(event.target.value)} className="min-h-20 w-full rounded-lg border border-hairline/40 bg-inset px-2 py-1.5 text-[13px] text-ink" />
        <button type="submit" disabled={busy || !name.trim() || !detail.trim()} className="rounded-md bg-accent px-2.5 py-1 text-[13px] text-white disabled:opacity-50">{t("botLearnings.submit")}</button>
      </form>}
    </section>
  );
}
