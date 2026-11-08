import { useState } from "react";
import { McpConnectorIcon } from "./McpConnectorIcon";
import { useMcpServers } from "@/lib/mcp-servers";
import { t } from "@/lib/i18n";
import { api } from "@/state/store";

export function McpAppSummary({ onManage, search }: { onManage: () => void; search: string }) {
  const { servers } = useMcpServers();
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, number | false>>({});
  const visible = servers?.filter(server => server.name.toLowerCase().includes(search.trim().toLowerCase())) ?? [];
  if (!visible.length) return null;

  const test = async (name: string) => {
    setBusy(name);
    try {
      const result = await api(`/api/mcp/servers/${encodeURIComponent(name)}/test`, { method: "POST" }) as { ok?: boolean; tools?: unknown[] };
      setResults(previous => ({ ...previous, [name]: result.ok && Array.isArray(result.tools) ? result.tools.length : false }));
    } catch {
      setResults(previous => ({ ...previous, [name]: false }));
    } finally {
      setBusy(null);
    }
  };

  return <section className="mb-4 rounded-xl border border-hairline/40 bg-card p-4" data-mcp-app-summary>
    <div className="mb-3 flex items-center justify-between gap-3">
      <h3 className="text-[14px] font-semibold text-ink">{t("mcp.title")}</h3>
      <button type="button" onClick={onManage} className="text-[13px] text-accent-text underline underline-offset-2">{t("apps.filter.mcp")}</button>
    </div>
    <div className="grid gap-2 sm:grid-cols-2">
      {visible.map(server => <div key={server.name} className="flex min-w-0 items-center gap-3 rounded-lg bg-inset px-3 py-2.5">
        <McpConnectorIcon name={server.name} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium text-ink">{server.name}</div>
          <div className="text-[12px] text-ink-secondary" role="status">
            {!server.enabled ? t("mcp.badge.off") : results[server.name] === false ? t("server.mcp.testFailed")
              : typeof results[server.name] === "number" ? t("server.mcp.testTools.many", { count: String(results[server.name]) }) : t("mcp.badge.on")}
          </div>
        </div>
        <button type="button" disabled={!server.enabled || busy !== null} onClick={() => void test(server.name)}
          className="rounded-lg bg-control px-3 py-1.5 text-[12px] text-ink disabled:opacity-40">{t("mcp.test")}</button>
      </div>)}
    </div>
  </section>;
}
