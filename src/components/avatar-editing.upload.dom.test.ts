// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";

const fixture = vi.hoisted(() => ({ upload: vi.fn(), request: vi.fn(), flush: vi.fn() }));
vi.mock("@/state/store", async (original) => ({
  ...await original<typeof import("@/state/store")>(),
  useStore: () => ({ flushBotPatches: fixture.flush }),
}));
vi.mock("./bot-settings/BotEditorContext", () => ({ useBotEditor: () => ({ request: fixture.request, uploadAvatar: fixture.upload }) }));

import { AvatarFraming, useAvatarImage } from "./avatar-editing";
import { loadLocale, setLocale } from "@/lib/i18n";

const bot = { id: "test", name: "Test", color: "blue", avatarCrop: "mascot" } as Bot;
let root: Root;
let host: HTMLDivElement;
let image: ReturnType<typeof useAvatarImage>;
const patch = vi.fn();

function Probe() {
  image = useAvatarImage(bot, patch);
  return null;
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fixture.upload.mockReset();
  patch.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(Probe)));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("saves the selected crop only after the upload succeeds", async () => {
  fixture.upload.mockResolvedValue("/api/attachments/test.png");
  const file = new File(["fake image"], "test.png", { type: "image/png" });
  const framing = { avatarCrop: "circle" as const, avatarZoom: 1.5, avatarFocusX: 0.3, avatarFocusY: 0.7 };
  let saved = false;
  await act(async () => { saved = await image.upload(file, framing); });
  expect(saved).toBe(true);
  expect(fixture.upload).toHaveBeenCalledWith(file);
  expect(patch).toHaveBeenCalledWith({ avatarUrl: "/api/attachments/test.png", ...framing });
});

it("keeps the existing avatar unchanged and reports an upload failure", async () => {
  fixture.upload.mockRejectedValue(new Error("Upload failed"));
  let saved = true;
  await act(async () => { saved = await image.upload(new File(["x"], "test.png", { type: "image/png" })); });
  expect(saved).toBe(false);
  expect(patch).not.toHaveBeenCalled();
  expect(image.error).toBe("Upload failed");
});

it("labels the avatar preview and zoom control in Simplified Chinese", async () => {
  await loadLocale("zh");
  try {
    await act(async () => root.render(createElement(AvatarFraming, { bot, disabled: false, onPatch: patch, previewUrl: "blob:preview", previewName: "photo.png" })));
    expect(host.querySelector("img")?.alt).toBe("Test的头像预览");
    expect(host.querySelector('input[type="range"]')?.getAttribute("aria-label")).toBe("缩放头像");
    expect(host.textContent).toContain("拖动以调整位置");
  } finally {
    setLocale("en");
  }
});
