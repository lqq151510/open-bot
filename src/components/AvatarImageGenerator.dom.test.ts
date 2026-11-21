// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ ready: true, dispatch: vi.fn() }));
vi.mock("@/state/store", () => ({ useStore: () => ({ state: { config: { imageGen: { ready: fixture.ready, provider: "openai", configured: fixture.ready } } }, dispatch: fixture.dispatch }) }));
import { AvatarImageGenerator } from "./AvatarImageGenerator";
import { loadLocale, setLocale } from "@/lib/i18n";

beforeEach(() => { fixture.ready = true; fixture.dispatch.mockReset(); });

it("requires a description and submits the trimmed text once", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const generate = vi.fn(async () => {});
  await act(async () => root.render(createElement(AvatarImageGenerator, { botLabel: "Test", disabled: false, generating: false, onGenerate: generate, compact: true })));
  const input = host.querySelector("textarea")!;
  const button = host.querySelector<HTMLButtonElement>("[data-avatar-generate]")!;
  expect(host.textContent).not.toContain("Uses OpenAI, as set in Image generation.");
  expect(host.textContent).not.toContain("Open image settings");
  expect(input.disabled).toBe(false);
  expect(input.placeholder).toBe("Describe your avatar…");
  expect(input.className.split(" ")).toEqual(expect.arrayContaining(["min-h-[11rem]", "resize-none", "rounded-xl", "border-ink/15", "bg-menu"]));
  expect(input.className).not.toContain("bg-inset");
  expect(button.textContent).toBe("Generate");
  expect(button.disabled).toBe(true);
  expect(button.className.split(" ")).toEqual(expect.arrayContaining(["h-[30px]", "w-full", "rounded-[10px]", "bg-[#767676]", "text-white"]));
  expect(button.className).not.toContain("disabled:opacity-50");
  expect(button.className).not.toContain("bg-ink");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "  blue owl  ");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(button.disabled).toBe(false);
  expect(button.className).toContain("bg-[#767676]");
  await act(async () => button.click());
  expect(generate).toHaveBeenCalledOnce();
  expect(generate).toHaveBeenCalledWith("blue owl");
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("keeps the default direction available in the full editor", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const generate = vi.fn(async () => {});
  await act(async () => root.render(createElement(AvatarImageGenerator, { botLabel: "Test", disabled: false, generating: false, onGenerate: generate })));
  const button = [...host.querySelectorAll("button")].find((item) => item.textContent === "Generate avatar")!;
  expect(host.textContent).toContain("Uses OpenAI, as set in Image generation.");
  expect(button.disabled).toBe(false);
  expect(button.hasAttribute("data-avatar-generate")).toBe(false);
  await act(async () => button.click());
  expect(generate).toHaveBeenCalledWith("");
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("offers image settings when no provider is ready", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fixture.ready = false;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const generate = vi.fn(async () => {});
  await act(async () => root.render(createElement(AvatarImageGenerator, { botLabel: "Test", disabled: false, generating: false, onGenerate: generate, compact: true })));
  expect(host.textContent).toContain("No image provider is set up yet.");
  expect(host.querySelector("textarea")!.disabled).toBe(true);
  const settings = [...host.querySelectorAll("button")].find((item) => item.textContent === "Open image settings")!;
  await act(async () => settings.click());
  expect(fixture.dispatch).toHaveBeenCalledWith({ type: "toggleAppSettings", open: true, section: "imageGeneration" });
  expect(generate).not.toHaveBeenCalled();
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("shows provider status and settings in Simplified Chinese", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await loadLocale("zh");
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const props = { botLabel: "测试", disabled: false, generating: false, onGenerate: vi.fn(async () => {}), compact: true };
  try {
    await act(async () => root.render(createElement(AvatarImageGenerator, props)));
    expect(host.textContent).not.toContain("使用图片生成设置中的 OpenAI。");
    expect(host.textContent).not.toContain("打开图片生成设置");
    expect(host.querySelector("textarea")!.placeholder).toBe("描述你的头像…");
    expect(host.querySelector("[data-avatar-generate]")!.textContent).toBe("生成");
    fixture.ready = false;
    await act(async () => root.render(createElement(AvatarImageGenerator, props)));
    expect(host.textContent).toContain("尚未配置图片生成服务。");
    expect(host.querySelector("textarea")!.disabled).toBe(true);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    setLocale("en");
    vi.unstubAllGlobals();
  }
});
