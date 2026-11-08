import { useState } from "react";
import { appCategoryLabel } from "@/lib/app-catalog";
import { t } from "@/lib/i18n";
import { findLocalAppGroups, LOCAL_APP_DIRECTORY } from "@/lib/local-app-directory";
import { McpConnectorIcon } from "./McpConnectorIcon";

export function LocalAppDirectory({ search, onManage, externalCategory = null }: { search: string; onManage: () => void; externalCategory?: string | null }) {
  const [category, setCategory] = useState<string | null>(null);
  const selected = externalCategory ?? category;
  const available = findLocalAppGroups(search);
  const groups = available.filter(group => !selected || group.category === selected);
  if (!available.length || (externalCategory && !groups.length)) return null;
  return <section className="mb-5 rounded-xl border border-hairline/40 bg-card p-4" data-local-app-directory>
    <h3 className="text-[14px] font-semibold text-ink">{t("apps.directory.title")}</h3>
    <p className="mt-1 text-[12px] text-ink-secondary">{t("apps.directory.description")}</p>
    {!externalCategory && <div className="mt-3 flex flex-wrap gap-1.5" aria-label={t("apps.directory.categories")}>
      <button type="button" aria-pressed={category === null} onClick={() => setCategory(null)} className="rounded-full bg-control px-3 py-1 text-[12px] text-ink">{t("apps.filter.all")}</button>
      {LOCAL_APP_DIRECTORY.map(group => <button key={group.category} type="button" aria-pressed={category === group.category}
        onClick={() => setCategory(group.category)} className={category === group.category ? "rounded-full bg-accent px-3 py-1 text-[12px] text-white" : "rounded-full bg-control px-3 py-1 text-[12px] text-ink"}>
        {appCategoryLabel(group.category)}
      </button>)}
    </div>}
    <div className="mt-4 space-y-4">
      {groups.length === 0 && <p className="text-[13px] text-ink-secondary">{t("connectors.noAppsFound")}</p>}
      {groups.map(group => <div key={group.category}>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h4 className="text-[13px] font-semibold text-ink">{appCategoryLabel(group.category)}</h4>
          {!selected && !search.trim() && group.apps.length > 6 && <button type="button" onClick={() => setCategory(group.category)} className="text-[12px] text-accent-text">{t("apps.directory.viewCategory")}</button>}
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {(selected || search.trim() ? group.apps : group.apps.slice(0, 6)).map(name => <div key={name} className="flex min-w-0 items-center gap-2 rounded-lg bg-inset px-3 py-2">
            <McpConnectorIcon name={name} showInitial />
            <span className="min-w-0 flex-1 truncate text-[13px] text-ink" title={name}>{name}</span>
            <button type="button" onClick={onManage} aria-label={`${t("apps.directory.configure")} ${name}`}
              className="shrink-0 rounded-full bg-control px-3 py-1 text-[12px] text-ink">{t("apps.directory.configure")}</button>
          </div>)}
        </div>
      </div>)}
    </div>
  </section>;
}
