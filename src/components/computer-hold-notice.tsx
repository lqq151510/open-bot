import { Hand } from "lucide-react";

import { t } from "@/lib/i18n";
import { showsYourControl } from "../../shared/computer-hold-view";

export function ComputerHoldNotice({ hold, pending, aside, onHandBack }: {
  hold: { held: boolean; heldByOther?: boolean };
  pending: boolean;
  aside: string;
  onHandBack: () => void;
}) {
  if (hold.heldByOther) {
    return (
      <div className="mt-3 rounded-xl border border-hairline bg-card p-4 text-[13px] leading-relaxed text-ink">
        {t("computer.heldByOther")}
      </div>
    );
  }
  if (!showsYourControl(hold)) return null;
  return (
    <div className="mt-3 rounded-xl border border-accent/25 bg-accent/10 p-4">
      <div className="text-[13px] leading-relaxed text-ink">
        {t("computer.youHaveWheel")}
        {aside ? ` ${aside}` : ""}
      </div>
      <button
        onClick={onHandBack}
        disabled={pending}
        className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-accent py-2 text-[13px] font-medium text-white hover:brightness-110 disabled:opacity-50"
      >
        <Hand size={14} />
        {t("computer.handBack")}
      </button>
    </div>
  );
}
