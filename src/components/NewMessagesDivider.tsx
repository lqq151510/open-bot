import { t } from "@/lib/i18n";
import { UNREAD_DIVIDER_FADE_MS } from "@/lib/unread-divider";
import { cn } from "@/lib/cn";

export function NewMessagesDivider({ fading }: { fading: boolean }) {
  return (
    <div
      role="separator"
      aria-label={t("chat.newMessagesAria")}
      data-unread-divider
      className={cn(
        "grid ease-out transition-[grid-template-rows,opacity,margin-bottom] motion-reduce:transition-none",
        fading ? "-mb-3 grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100",
      )}
      style={{ transitionDuration: `${UNREAD_DIVIDER_FADE_MS}ms` }}
    >
      <div className="min-h-0 overflow-hidden">
        <div aria-hidden="true" className="animate-msg-in flex items-center gap-3 py-0.5">
          <span className="unread-divider-line h-px flex-1" />
          <span className="unread-divider-label text-[11px] font-medium leading-4">
            {t("chat.newMessages")}
          </span>
          <span className="unread-divider-line h-px flex-1" />
        </div>
      </div>
    </div>
  );
}
