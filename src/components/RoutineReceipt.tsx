import { useId, useState, type ReactNode } from "react";
import { ChevronDown, Clock3 } from "lucide-react";

import { t } from "@/lib/i18n";

export function RoutineReceipt({ status, name, onOpen, notice, children }: {
  status: string;
  name: string;
  onOpen: () => void;
  notice?: string;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();

  return (
    <div data-routine-receipt className="w-full text-[13px] text-ink-secondary">
      <div className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5 py-1">
        <span className="shrink-0">{status}</span>
        <button type="button" onClick={onOpen} aria-label={t("routines.openRoutine", { name })} title={name}
          className="flex min-h-6 min-w-0 max-w-full items-center gap-1 rounded-md px-1 hover:bg-inset hover:text-ink focus-visible:outline-2 focus-visible:outline-focus">
          <Clock3 size={14} className="shrink-0" aria-hidden="true" />
          <span className="truncate">{name}</span>
        </button>
        <button type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} aria-controls={detailsId}
          aria-label={t(expanded ? "approval.applied.hideDetails" : "approval.applied.details")}
          className="flex size-6 shrink-0 items-center justify-center rounded-full hover:bg-inset hover:text-ink focus-visible:outline-2 focus-visible:outline-focus">
          <ChevronDown size={13} className={expanded ? "rotate-180" : undefined} aria-hidden="true" />
        </button>
      </div>
      {notice && !expanded && <p className="pb-1 text-center text-[12px] text-warning">{notice}</p>}
      <div id={detailsId} hidden={!expanded}>
        {expanded && children}
      </div>
    </div>
  );
}
