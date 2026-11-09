import { AppWindow, Brain, FileText, Folder, Globe, Image, Zap } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { t } from "@/lib/i18n";
import { usePageOpener } from "@/lib/page-open";
import { shortPath } from "@/lib/short-path";
import { attachmentImageUrl } from "@/lib/composer-attachments";
import { SIDEBAR_INLINE, useMediaQuery } from "@/lib/use-media-query";
import { useStore, visibleMessages, type Bot, type Message } from "@/state/store";
import { AttachedFileChip } from "../AttachmentPreview";
import { isAudioAttachment, isVideoAttachment } from "../AttachmentGallery";
import { recentChangedFiles, sharedFileReferences } from "../ComputerFilesPane";
import { useDesktopCapabilities } from "../DesktopCapabilities";
import { useManagedSkills } from "../bot-settings/SkillsSection";
import type { SimplePageId } from "./page-registry";
import { Card, CardLabel, NavRow } from "./rows";
import { panelMemoryNotes } from "./memory-notes";
import { useMemoryDoc } from "./use-memory-doc";

export interface LibraryItems {
  pages: Array<{ messageId: string; title: string; url: string }>;
  apps: Array<{ messageId: string; title: string }>;
  images: Array<{ messageId: string; path: string; title: string }>;
  mediaFiles: Array<NonNullable<ReturnType<ReturnType<typeof sharedFileReferences>["get"]>>>;
  shared: Array<NonNullable<ReturnType<ReturnType<typeof sharedFileReferences>["get"]>>>;
  unshared: string[];
}

/** What the bot made in the open conversation, newest first: its live published pages, its apps, and its files. */
export function libraryItems(bot: Bot, messages: readonly Message[] = visibleMessages(bot)): LibraryItems {
  const pages: LibraryItems["pages"] = [];
  const apps: LibraryItems["apps"] = [];
  const images: LibraryItems["images"] = [];
  const seenPages = new Set<string>();
  const seenImages = new Set<string>();
  for (const message of [...messages].reverse()) {
    const page = message.publishedPage;
    if (page?.state === "live" && page.url && !seenPages.has(page.url)) {
      seenPages.add(page.url);
      pages.push({ messageId: message.id, title: page.title || page.url, url: page.url });
    }
    if (message.kind === "app" && message.app?.doc) apps.push({ messageId: message.id, title: message.app.title });
    if (message.role === "bot" && message.kind === "text") {
      for (const attachment of message.attachments ?? []) {
        if ((attachment.kind !== "image" && attachment.kind !== undefined) || seenImages.has(attachment.path)) continue;
        seenImages.add(attachment.path);
        images.push({ messageId: message.id, path: attachment.path, title: attachment.name || fileName(attachment.path) });
      }
    }
  }
  const references = sharedFileReferences(bot);
  const shared: LibraryItems["shared"] = [];
  const mediaFiles: LibraryItems["mediaFiles"] = [];
  const seenFiles = new Set<string>();
  for (const reference of references.values()) {
    if (seenFiles.has(reference.file.path)) continue;
    seenFiles.add(reference.file.path);
    if (isVideoAttachment(reference.file.path) || isAudioAttachment(reference.file.path)) mediaFiles.push(reference);
    else shared.push(reference);
  }
  const unshared = recentChangedFiles(bot).filter((path) => !references.has(path));
  return { pages, apps, images, mediaFiles, shared, unshared };
}

const fileName = (path: string) => path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);

export function LibraryTab({ bot, onOpen }: { bot: Bot; onOpen: (page: SimplePageId) => void }) {
  const { dispatch } = useStore();
  const { capabilities } = useDesktopCapabilities();
  const openPage = usePageOpener();
  const phone = !useMediaQuery(SIDEBAR_INLINE, true);
  const skills = useManagedSkills(bot);
  const memory = useMemoryDoc(bot);
  const { pages, apps, images, mediaFiles, shared, unshared } = useMemo(() => libraryItems(bot), [bot]);
  const [selection, setSelection] = useState<{ botId: string; category: "all" | "pages" | "apps" | "images" | "files" }>({ botId: bot.id, category: "all" });
  const categories = [
    { id: "pages", label: t("botPanel.library.pages"), count: pages.length },
    ...(apps.length ? [{ id: "apps" as const, label: t("botPanel.library.apps"), count: apps.length }] : []),
    { id: "images", label: t("botPanel.library.media"), count: images.length + mediaFiles.length },
    { id: "files", label: t("botPanel.library.files"), count: shared.length + unshared.length },
  ] as const;
  const selected = selection.botId === bot.id && (selection.category === "all" || categories.some((category) => category.id === selection.category)) ? selection.category : "all";
  const total = pages.length + apps.length + images.length + mediaFiles.length + shared.length + unshared.length;
  const selectedCount = selected === "all" ? total : categories.find((category) => category.id === selected)?.count ?? 0;
  const showInChat = (messageId: string) => {
    dispatch({ type: "focusMessage", threadId: bot.threadId, messageId });
    if (phone) dispatch({ type: "toggleSettings", open: false });
  };
  const messageTimes = new Map(visibleMessages(bot).map((message) => [message.id, message.at]));
  const entries: Array<{ key: string; category: "pages" | "apps" | "images" | "files"; at?: number; node: ReactNode }> = [
    ...pages.map((page) => ({ key: `page:${page.url}`, category: "pages" as const, at: messageTimes.get(page.messageId), node: <NavRow data-panel-row="page" icon={Globe} drill={false} title={<span className="block truncate">{page.title}</span>} onClick={() => openPage(page.url)} /> })),
    ...apps.map((app) => ({ key: `app:${app.messageId}`, category: "apps" as const, at: messageTimes.get(app.messageId), node: <NavRow data-panel-row="app" icon={AppWindow} drill={false} title={<span className="block truncate">{app.title}</span>} onClick={() => showInChat(app.messageId)} /> })),
    ...images.map((image) => ({ key: `image:${image.path}`, category: "images" as const, at: messageTimes.get(image.messageId), node: <button type="button" data-panel-row="image" onClick={() => showInChat(image.messageId)} className="flex min-h-[46px] w-full items-center gap-2.5 px-3.5 py-[11px] text-left hover:bg-ink/[0.03]"><span className="relative flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-md bg-ink/[0.05] text-ink-secondary"><Image size={15} aria-hidden="true" />{attachmentImageUrl(image.path) && <img src={attachmentImageUrl(image.path)!} alt="" className="absolute inset-0 size-full object-cover" onError={(event) => { event.currentTarget.hidden = true; }} />}</span><span className="min-w-0 truncate text-[14px] font-medium text-ink">{image.title}</span></button> })),
    ...mediaFiles.map((reference) => ({ key: `media:${reference.file.path}`, category: "images" as const, at: messageTimes.get(reference.message.messageId), node: <div data-panel-row="media-file"><AttachedFileChip file={reference.file} message={reference.message} linked={reference.file.linked} className="w-full max-w-none rounded-none border-0 bg-transparent text-[14px]" /></div> })),
    ...shared.map((reference) => ({ key: `file:${reference.file.path}`, category: "files" as const, at: messageTimes.get(reference.message.messageId), node: <AttachedFileChip file={reference.file} message={reference.message} linked={reference.file.linked} className="w-full max-w-none rounded-none border-0 bg-transparent text-[14px]" /> })),
    ...unshared.map((path) => ({ key: `unshared:${path}`, category: "files" as const, node: <div title={t("computer.files.notSharedHint")} className="flex min-w-0 items-center gap-2 px-3 py-2"><FileText size={14} className="shrink-0 text-ink-secondary" aria-hidden="true" /><span className="min-w-0 flex-1 truncate text-[13px] text-ink">{fileName(path)}</span><span className="shrink-0 text-[11px] text-ink-tertiary">{t("computer.files.notShared")}</span></div> })),
  ];
  const now = new Date();
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6).getTime();
  const groups = [
    { id: "week", label: t("botPanel.library.thisWeek"), matches: (at?: number) => at !== undefined && Number.isFinite(at) && at >= weekStart },
    { id: "earlier", label: t("botPanel.library.earlier"), matches: (at?: number) => at !== undefined && Number.isFinite(at) && at < weekStart },
    { id: "undated", label: t("botPanel.library.undated"), matches: (at?: number) => at === undefined || !Number.isFinite(at) },
  ].map((group) => ({ ...group, entries: entries.filter((entry) => (selected === "all" || entry.category === selected) && group.matches(entry.at)).sort((a, b) => (b.at ?? 0) - (a.at ?? 0)) }));
  const skillsOn = skills.skills.filter((skill) => skill.enabled).length;
  const notes = memory.docs ? panelMemoryNotes(memory.docs).length : null;
  const memoryValue = bot.memoryEnabled === false ? t("botPanel.memory.off")
    : notes === null ? (memory.error ? t("botPanel.memory.nothingYet") : undefined)
    : notes === 0 ? t("botPanel.memory.nothingYet")
    : notes === 1 ? t("botPanel.memory.note") : t("botPanel.memory.notes", { count: notes });
  const keeps = (
    <Card anchor="keeps">
      <NavRow data-panel-page="memory" icon={Brain} title={t("botPanel.memoryRow")} value={memoryValue} onClick={() => onOpen("memory")} />
      <NavRow
        data-panel-page="skills"
        icon={Zap}
        title={t("botSettings.simple.skills")}
        value={skills.loading ? undefined : skillsOn > 0 ? skillsOn : t("botPanel.none")}
        onClick={() => onOpen("skills")}
      />
      <NavRow
        data-panel-page="folder"
        icon={Folder}
        title={t("computer.files.folder")}
        value={bot.cwd ? shortPath(bot.cwd, capabilities.host?.homeDir) : t("botPanel.folder.private")}
        onClick={() => onOpen("folder")}
      />
    </Card>
  );

  return (
    <div data-panel-tabpanel="library">
      <div role="group" aria-label={t("botPanel.tab.library")} className="mb-3 flex flex-wrap gap-1.5">
        {[{ id: "all" as const, label: t("apps.filter.all") }, ...categories].map((category) => (
          <button key={category.id} type="button" aria-pressed={selected === category.id} onClick={() => setSelection({ botId: bot.id, category: category.id })}
            className="rounded-full bg-ink/[0.06] px-3 py-1.5 text-[12px] font-medium text-ink-secondary transition-colors hover:bg-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus aria-pressed:bg-ink aria-pressed:text-app">
            {category.label}
          </button>
        ))}
      </div>
      {selectedCount === 0 && (
        <p data-panel-empty="library" className="px-3 py-7 text-center text-[13px] leading-[18px] text-ink-tertiary">
          {selected === "all" ? t("botPanel.library.empty") : t("botPanel.library.emptyCategory")}
        </p>
      )}
      {groups.filter((group) => group.entries.length > 0).map((group) => (
        <section key={group.id} data-library-period={group.id}>
          <CardLabel>{group.label}</CardLabel>
          <div className="overflow-hidden rounded-xl bg-composer ring-1 ring-inset ring-ink/[0.06]">{group.entries.map((entry) => <div key={entry.key}>{entry.node}</div>)}</div>
        </section>
      ))}
      {selectedCount > 0 && <p className="mt-3 text-center text-[12px] text-ink-tertiary">{t("botPanel.library.scope")}</p>}
      {keeps}
    </div>
  );
}
