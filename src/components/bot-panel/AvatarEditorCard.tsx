import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown, Loader2, Trash2 } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { bodyName, colorName } from "@/lib/mascot-names";
import type { LocaleKey } from "@/locales";
import { colorSwatch, MAUS_COLOR_LABEL, MAUS_COLOR_NAMES, PICKABLE_STATES, type MausState } from "@/lib/mascot";
import type { Bot } from "@/state/store";
import { MASCOT_BODY_IDS } from "../../../shared/mascot-bodies";
import { HALLOWEEN_BODY_IDS } from "../../../shared/halloween-bodies";
import { isHalloweenBody, type BotBodyId } from "../../../shared/bot-body";
import { useHalloweenDressed, wornBody } from "@/lib/halloween-dress";
import { clipboardImageFiles, IMAGE_MAX_BYTES, isImageFile } from "@/lib/composer-attachments";
import { MausAvatar } from "../Avatar";
import { AvatarImageGenerator } from "../AvatarImageGenerator";
import { AvatarFraming, RESET_MASCOT_PATCH, useAvatarImage, type AvatarPatch } from "../avatar-editing";
import { Segmented } from "./rows";
import { MascotFaceColorPicker } from "../MascotFaceColorPicker";

export type AvatarEditorTab = "bot" | "generate" | "upload";

const TABS: ReadonlyArray<readonly [AvatarEditorTab, LocaleKey]> = [
  ["bot", "botPanel.avatar.tabBot"],
  ["generate", "botPanel.avatar.tabGenerate"],
  ["upload", "botPanel.avatar.tabUpload"],
];

const IMAGE_CROPS = ["circle", "rounded", "square"] as const;
const CROP_KEY: Record<(typeof IMAGE_CROPS)[number], LocaleKey> = {
  circle: "botPanel.avatar.circle",
  rounded: "botPanel.avatar.rounded",
  square: "botPanel.avatar.square",
};

const FACE_KEY: Partial<Record<MausState, LocaleKey>> = {
  idle: "botPanel.face.idle",
  happy: "botPanel.face.happy",
  curious: "botPanel.face.curious",
  drowsy: "botPanel.face.drowsy",
  working: "botPanel.face.working",
  thinking: "botPanel.face.thinking",
  listening: "botPanel.face.listening",
  sleeping: "botPanel.face.sleeping",
  suspicious: "botPanel.face.suspicious",
  proud: "botPanel.face.proud",
};

const faceLabel = (state: MausState) => {
  const key = FACE_KEY[state];
  return key ? t(key) : state;
};

export function AvatarEditorCard({ bot, activeState, onPatch, onClose }: {
  bot: Bot;
  activeState: MausState;
  onPatch: (patch: AvatarPatch) => void;
  onClose: () => void;
}) {
  const image = useAvatarImage(bot, onPatch);
  const { fileRef, crop, uploading, generating, busy, error, upload, removeImage, generate } = image;
  const showsImage = crop !== "mascot" && Boolean(bot.avatarUrl);
  const [tab, setTab] = useState<AvatarEditorTab>(showsImage ? "upload" : "bot");
  const [pending, setPending] = useState<{ file: File; url: string; framing: AvatarPatch; decoded: boolean; size?: { width: number; height: number } } | null>(null);
  const [pendingError, setPendingError] = useState<string | null>(null);
  useEffect(() => () => { if (pending) URL.revokeObjectURL(pending.url); }, [pending?.url]);
  const stage = (file: File | undefined) => {
    if (!file || busy) return;
    if (!isImageFile(file) || file.size > IMAGE_MAX_BYTES) {
      setPendingError(t("botPanel.avatar.invalidImage"));
      return;
    }
    setPendingError(null);
    setPending({ file, url: URL.createObjectURL(file), framing: { avatarCrop: "circle", avatarZoom: 1, avatarFocusX: 0.5, avatarFocusY: 0.5 }, decoded: false });
  };
  const tabsRef = useRef<HTMLDivElement>(null);
  // The card is a dialog: focus moves into it, onto the tab it opened on, so Escape and Tab work from the start.
  useEffect(() => {
    tabsRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
  }, []);
  const pickMascot = (patch: AvatarPatch) => onPatch(crop === "mascot" ? patch : { ...patch, avatarCrop: "mascot" });
  const body = bot.mascotBody ?? "cursor";
  const dressed = useHalloweenDressed();
  const costume = wornBody(bot.mascotBody, bot.color, dressed);
  const [moreLooks, setMoreLooks] = useState(() => dressed || isHalloweenBody(body) || Boolean(bot.mascotExpression && bot.mascotExpression !== "idle"));
  const dressedAs = costume !== body && isHalloweenBody(costume) ? bodyName(costume) : null;
  const bodyButton = (id: BotBodyId, name: string) => (
    <button
      key={id}
      type="button"
      disabled={busy}
      aria-pressed={!showsImage && body === id}
      aria-label={t("mascot.useBody", { name })}
      title={name}
      onClick={() => pickMascot({ mascotBody: id })}
      className={cn(
        "flex h-[58px] items-center justify-center rounded-xl disabled:opacity-50",
        !showsImage && body === id ? "bg-ink/[0.08] ring-[1.5px] ring-inset ring-ink/25" : "hover:bg-ink/[0.05]",
      )}
    >
      <MausAvatar color={bot.color} faceColor={bot.mascotFaceColor} bodyId={id} size={40} animated={false} trackPointer={false} />
    </button>
  );

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-label={t("botPanel.avatar.edit")}
      data-panel-avatar-editor
      onKeyDown={onKeyDown}
      onPaste={(event) => {
        if (tab !== "upload" || busy) return;
        const file = clipboardImageFiles(event.clipboardData)[0];
        if (file) { event.preventDefault(); stage(file); }
      }}
      className="popover-surface absolute inset-x-[-5px] top-[80px] z-30 overflow-hidden rounded-2xl border border-ink/[0.08] bg-menu text-left shadow-2xl shadow-black/50"
    >
      <div ref={tabsRef} className="flex items-center gap-0.5 border-b border-ink/[0.06] p-2">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            data-avatar-tab={id}
            onClick={() => setTab(id)}
            className={cn(
              "rounded-lg px-[11px] py-[5px] text-[13px]",
              tab === id ? "bg-ink/[0.08] font-medium text-ink" : "text-ink-secondary hover:text-ink",
            )}
          >
            {t(label)}
          </button>
        ))}
        <button
          type="button"
          data-avatar-reset
          disabled={busy}
          onClick={() => onPatch(RESET_MASCOT_PATCH)}
          className="ml-auto rounded-lg px-[11px] py-[5px] text-[13px] text-ink-secondary hover:text-ink disabled:opacity-50"
        >
          {t("botPanel.avatar.reset")}
        </button>
      </div>

      <div className="p-3">
        {tab === "bot" && (
          <>
            <div className="grid grid-cols-5 gap-1.5">
              {MASCOT_BODY_IDS.map((id) => bodyButton(id, bodyName(id)))}
            </div>
            <div className="flex flex-wrap justify-center gap-2 px-1 pb-1 pt-3.5">
              {MAUS_COLOR_NAMES.map((color) => (
                <button
                  key={color}
                  type="button"
                  disabled={busy}
                  aria-pressed={bot.color === color}
                  aria-label={t("mascot.useColor", { color: colorName(color) })}
                  title={t(MAUS_COLOR_LABEL[color])}
                  onClick={() => pickMascot({ color })}
                  className={cn(
                    "size-6 rounded-full disabled:opacity-50",
                    bot.color === color && "ring-2 ring-ink/80 ring-offset-2 ring-offset-menu",
                  )}
                  style={{ background: colorSwatch(color) }}
                />
              ))}
            </div>
            <MascotFaceColorPicker bot={bot} disabled={busy} onPatch={pickMascot} />
            <button
              type="button"
              data-avatar-more
              aria-expanded={moreLooks}
              onClick={() => setMoreLooks((open) => !open)}
              className="mx-auto mt-2.5 flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] text-ink-secondary hover:bg-ink/[0.04] hover:text-ink"
            >
              {t("botPanel.avatar.more")}
              <ChevronDown size={13} aria-hidden="true" className={cn("transition-transform", moreLooks && "rotate-180")} />
            </button>
            {moreLooks && (
              <div data-avatar-more-looks>
                <div className="flex flex-wrap items-baseline gap-x-2 px-1 pb-1.5 pt-2 text-[12px] text-ink-tertiary">
                  <span>{t("botPanel.avatar.halloween")}</span>
                  {dressedAs && <span data-avatar-costume>{t("botPanel.avatar.costume", { name: dressedAs })}</span>}
                </div>
                <div className="grid grid-cols-5 gap-1.5" data-halloween-bodies>
                  {HALLOWEEN_BODY_IDS.map((id) => bodyButton(id, bodyName(id)))}
                </div>
                <div className="flex flex-wrap items-center justify-center gap-1.5 pt-2.5" role="group" aria-label={t("botPanel.avatar.face")}>
                  <span className="mr-0.5 text-[12px] text-ink-tertiary">{t("botPanel.avatar.face")}</span>
                  {PICKABLE_STATES.map((expression) => (
                    <button
                      key={expression}
                      type="button"
                      disabled={busy}
                      data-avatar-face={expression}
                      aria-pressed={activeState === expression}
                      onClick={() => pickMascot({ mascotExpression: expression })}
                      className={cn(
                        "rounded-full px-2.5 py-1 text-[12px] disabled:opacity-50",
                        activeState === expression ? "bg-ink/[0.15] text-ink" : "bg-ink/[0.04] text-ink-secondary hover:text-ink",
                      )}
                    >
                      {faceLabel(expression)}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {tab === "generate" && (
          <div className="[&>div:first-child]:mt-0 [&>div:first-child]:border-0 [&>div:first-child]:pt-0">
            <AvatarImageGenerator
              botLabel={bot.title || bot.name}
              compact
              disabled={uploading}
              generating={generating}
              onGenerate={generate}
            />
          </div>
        )}

        {tab === "upload" && (
          <>
            {pending ? <>
              <AvatarFraming bot={{ ...bot, ...pending.framing }} previewUrl={pending.url} previewName={`${pending.file.name}${pending.size ? ` · ${pending.size.width}×${pending.size.height}` : ""}`} disabled={busy} onPatch={(patch) => setPending((current) => current ? { ...current, framing: { ...current.framing, ...patch } } : current)}
                onPreviewLoad={(size) => setPending((current) => current?.url === pending.url ? { ...current, decoded: true, size } : current)}
                onPreviewError={() => { setPendingError(t("botPanel.avatar.invalidImage")); setPending((current) => current?.url === pending.url ? { ...current, decoded: false } : current); }} />
              <div className="mt-3 flex gap-2">
                <button type="button" data-avatar-restart disabled={busy} onClick={() => { setPending(null); setPendingError(null); }} className="flex-1 rounded-lg bg-control px-3 py-2 text-[13px] text-ink disabled:opacity-50">{t("botPanel.avatar.restart")}</button>
                <button type="button" data-avatar-apply disabled={busy || !pending.decoded} onClick={() => void upload(pending.file, pending.framing).then((saved) => { if (saved) setPending(null); })} className="flex-1 rounded-lg bg-ink px-3 py-2 text-[13px] text-app disabled:opacity-50">{t("botPanel.avatar.apply")}</button>
              </div>
            </> : <>
            {showsImage && <AvatarFraming bot={bot} disabled={busy} onPatch={onPatch} />}
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              className="sr-only"
              onChange={(event) => { stage(event.target.files?.[0]); event.target.value = ""; }}
            />
            <button
              type="button"
              data-avatar-drop
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                stage(event.dataTransfer.files?.[0]);
              }}
              className="flex min-h-[220px] w-full flex-col items-center justify-center gap-2 rounded-xl border-[1.5px] border-dashed border-ink/15 px-3 py-6 text-center text-[13px] text-ink-secondary hover:border-ink/25 hover:text-ink disabled:opacity-50"
            >
              {uploading && <Loader2 size={22} className="animate-spin" />}
              <span>{t("botPanel.avatar.drop")}</span>
              <span className="text-[12px] text-ink-tertiary">{t("botPanel.avatar.or")}</span>
              <span className="rounded-lg bg-ink/[0.06] px-3.5 py-1.5 font-medium text-ink">{t("botPanel.avatar.chooseLocal")}</span>
            </button>
            {showsImage && (
              <div className="mt-2.5 flex items-center gap-2.5">
                <span className="shrink-0 text-[12px] text-ink-secondary">{t("botPanel.avatar.shape")}</span>
                <Segmented
                  attr="data-avatar-crop"
                  label={t("botPanel.avatar.shape")}
                  value={crop}
                  onChange={(next) => onPatch({ avatarCrop: next })}
                  options={IMAGE_CROPS.map((value) => ({ value, label: t(CROP_KEY[value]), disabled: busy || !bot.avatarUrl }))}
                />
                {bot.avatarUrl && (
                  <button
                    type="button"
                    onClick={removeImage}
                    disabled={busy}
                    aria-label={t("botIdentity.removeAvatar")}
                    title={t("botPanel.avatar.remove")}
                    className="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-secondary hover:bg-control hover:text-danger disabled:opacity-50"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            )}
            </>}
          </>
        )}

        {(pendingError || error) && <div role="alert" className="mt-3 text-[12px] text-danger">{pendingError || error}</div>}
      </div>
    </div>
  );
}
