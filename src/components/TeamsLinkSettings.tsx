import { useEffect, useState } from "react";
import { t } from "@/lib/i18n";
import { api, ApiError } from "@/state/store";

type LinkCode = { secret: string; expiresAt: number };

export function TeamsLinkSettings() {
  const [code, setCode] = useState<LinkCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!code) return;
    const timer = window.setTimeout(() => setCode(null), Math.max(0, code.expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [code]);

  async function update(method: "POST" | "DELETE") {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    setCode(null);
    try {
      if (method === "POST") {
        const value = await api<LinkCode>("/api/microsoft-teams/link", { method });
        if (!value || !/^[A-Za-z0-9_-]{43}$/.test(value.secret) || !Number.isFinite(value.expiresAt) || value.expiresAt <= Date.now()) {
          throw new Error(t("teamsLink.error"));
        }
        setCode(value);
      } else {
        await api("/api/microsoft-teams/link", { method });
        setNotice(t("teamsLink.revoked"));
      }
    } catch (cause) {
      setError(cause instanceof ApiError && (cause.status === 403 || cause.status === 404)
        ? t("teamsLink.unavailable") : t("teamsLink.error"));
    } finally { setBusy(false); }
  }

  return <section className="rounded-xl bg-card p-4" aria-label={t("teamsLink.title")}>
    <h3 className="text-[15px] font-medium text-ink">{t("teamsLink.title")}</h3>
    <p className="mt-1 text-[13px] text-ink-secondary">{t("teamsLink.description")}</p>
    <div className="mt-3 flex flex-wrap gap-2">
      <button type="button" disabled={busy} onClick={() => void update("POST")} className="rounded-md bg-accent px-2.5 py-1 text-[13px] text-white disabled:opacity-50">{t("teamsLink.create")}</button>
      <button type="button" disabled={busy} onClick={() => void update("DELETE")} className="rounded-md px-2.5 py-1 text-[13px] text-ink-secondary hover:bg-control disabled:opacity-50">{t("teamsLink.disconnect")}</button>
    </div>
    {code && <div className="mt-3 text-[13px]"><p className="text-ink-secondary">{t("teamsLink.instructions")}</p><code className="mt-1 block select-all break-all rounded-lg bg-inset p-2 text-ink">/openbot-link {code.secret}</code><p className="mt-1 text-ink-secondary">{t("teamsLink.private")}</p></div>}
    {notice && <p role="status" className="mt-2 text-[13px] text-ink-secondary">{notice}</p>}
    {error && <p role="alert" className="mt-2 text-[13px] text-danger">{error}</p>}
  </section>;
}
