import { useEffect, useRef, useState, type RefObject } from "react";
import { CalendarDays, Images } from "lucide-react";
import type { Bot, InstanceInfo } from "@/state/store";
import { intakeFilesWithNotice } from "@/lib/attach-notice";
import { imageBytesLeft, imageSlotsLeft, pasteAttachment, type Attachment } from "@/lib/composer-attachments";
import { changeDraftAttachmentPending } from "@/lib/drafts";
import { t } from "@/lib/i18n";
import { modelName, providerName } from "@/lib/simple-model-menu";
import { pathForFile } from "./ComposerAttachments";
import { LocalBriefingDialog } from "./LocalBriefingDialog";
import type { SidebarMenuItem } from "./SidebarPopoverMenu";

export function useComposerLocalInputs({
  draftId, locked, remoteClient, bot, instances, opener, attachments, allowImages,
  attachmentPending, uploadImage, onAdd, onNotice, refocusInput,
}: {
  draftId: string;
  locked: boolean;
  remoteClient: boolean;
  bot?: Bot;
  instances: InstanceInfo[];
  opener: RefObject<HTMLDivElement | null>;
  attachments: Attachment[];
  allowImages: boolean;
  attachmentPending: boolean;
  uploadImage: Parameters<typeof intakeFilesWithNotice<File>>[1]["uploadImage"];
  onAdd(attachments: Attachment[]): void;
  onNotice(notice: string | null): void;
  refocusInput(): void;
}) {
  const desktop = remoteClient ? undefined : window.ogb;
  const calendarBridge = bot ? desktop?.localCalendar : undefined;
  const photosBridge = desktop?.localPhotos;
  const currentDraftId = useRef(draftId);
  currentDraftId.current = draftId;
  const [briefingDraft, setBriefingDraft] = useState<string | null>(null);
  const briefingOpener = useRef<HTMLButtonElement | null>(null);
  useEffect(() => setBriefingDraft(null), [draftId, locked]);
  const localItems: SidebarMenuItem[] = [];

  const attachmentTarget = useRef({ allowImages, attachments });
  attachmentTarget.current = { allowImages, attachments };
  const attachFiles = async (files: File[], extraNotice?: string) => {
    const current = attachmentTarget.current;
    const { attachments: added, notice } = await intakeFilesWithNotice(files, {
      allowImages: current.allowImages,
      getPath: pathForFile,
      uploadImage,
      imageSlots: imageSlotsLeft(current.attachments),
      imageBytes: imageBytesLeft(current.attachments),
    });
    if (added.length) onAdd(added);
    if (currentDraftId.current === draftId) onNotice([extraNotice, notice].filter(Boolean).join(" ") || null);
  };
  const pickFiles = async (picked: FileList | null) => {
    if (!picked?.length) return;
    changeDraftAttachmentPending(draftId, true);
    try {
      await attachFiles(Array.from(picked));
    } finally {
      changeDraftAttachmentPending(draftId, false);
    }
    refocusInput();
  };

  const photoRequest = useRef<symbol | null>(null);
  useEffect(() => () => { photoRequest.current = null; }, [draftId, locked, photosBridge]);
  const photoSlots = imageSlotsLeft(attachments);
  const photoBytes = imageBytesLeft(attachments);
  const photoDisabled = !allowImages ? t("composer.error.noImages")
    : photoSlots < 1 || photoBytes < 1 ? t("composer.photos.full") : undefined;
  const pickPhotos = async () => {
    if (!photosBridge || locked || photoRequest.current || attachmentPending || photoDisabled) return;
    const request = Symbol("photos");
    photoRequest.current = request;
    changeDraftAttachmentPending(draftId, true);
    try {
      const result = await photosBridge.pick(photoSlots, photoBytes);
      if (photoRequest.current !== request || currentDraftId.current !== draftId || result.status === "cancelled") return;
      if (result.status !== "selected") {
        onNotice(t(result.status === "busy" ? "composer.photos.busy" : "composer.photos.failed"));
        return;
      }
      if (!attachmentTarget.current.allowImages) {
        onNotice(t("composer.error.noImages"));
        return;
      }
      const photos = result.photos.map((data, index) => new File([new Uint8Array(data)], t("composer.photos.file", { index: index + 1 }), { type: "image/jpeg" }));
      await attachFiles(photos, result.skipped ? t("composer.photos.skipped", { count: result.skipped }) : undefined);
    } catch {
      if (photoRequest.current === request && currentDraftId.current === draftId) onNotice(t("composer.photos.failed"));
    } finally {
      changeDraftAttachmentPending(draftId, false);
      if (photoRequest.current === request) {
        photoRequest.current = null;
        refocusInput();
      }
    }
  };

  if (photosBridge) {
    localItems.push({
      key: "local-photos",
      label: t("composer.photos.pick"),
      icon: <Images size={16} />,
      note: photoDisabled,
      disabled: attachmentPending || Boolean(photoDisabled),
      onSelect: () => void pickPhotos(),
    });
  }
  if (calendarBridge) {
    localItems.push({
      key: "local-briefing",
      label: t("localBrief.title"),
      icon: <CalendarDays size={16} />,
      onSelect: () => {
        briefingOpener.current = opener.current?.querySelector("[data-composer-plus]")?.closest("button") ?? null;
        setBriefingDraft(draftId);
      },
    });
  }

  const briefingOpen = !locked && briefingDraft === draftId;
  const briefingInstance = briefingOpen && bot ? instances.find(instance => instance.instanceId === bot.modelSelection.instanceId) : undefined;
  const model = bot?.modelSelection;
  const modelProvider = briefingInstance && model
    ? briefingInstance.models.options.find(option => option.id === model.model)?.provider ?? providerName(briefingInstance)
    : undefined;
  const briefing = briefingOpen && calendarBridge && (
    <LocalBriefingDialog
      key={draftId}
      bridge={calendarBridge}
      returnFocus={briefingOpener.current}
      model={modelProvider || (model ? modelName(briefingInstance, model.model, model.variant) : undefined)}
      onClose={() => setBriefingDraft(null)}
      onAdd={brief => {
        onAdd([pasteAttachment(brief)]);
        setBriefingDraft(null);
      }}
    />
  );
  return { pickFiles, localItems, briefing };
}
