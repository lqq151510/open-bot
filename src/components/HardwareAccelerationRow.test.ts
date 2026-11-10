// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import { HardwareAccelerationRow } from "./HardwareAccelerationRow";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root | null = null;
let saved: { on: boolean; restart: boolean; available: boolean };
const set = vi.fn(async (on: boolean) => { saved = { on, restart: !on, available: true }; return saved; });
const relaunch = vi.fn(async () => true);

beforeEach(() => {
  setLocale("en");
  saved = { on: true, restart: false, available: true };
  set.mockClear(); relaunch.mockClear();
  Object.assign(window, { ogb: { hardwareAcceleration: { state: async () => saved, set }, relaunch } });
  host = document.createElement("div");
  document.body.append(host);
});
afterEach(async () => { await act(async () => root?.unmount()); root = null; host.remove(); delete (window as { ogb?: unknown }).ogb; });

async function mount() {
  root = createRoot(host);
  await act(async () => root!.render(createElement(HardwareAccelerationRow)));
  await act(async () => { await Promise.resolve(); });
}
const toggle = () => host.querySelector<HTMLButtonElement>('[aria-label="Use hardware acceleration"]');
const note = () => host.querySelector("[data-hardware-acceleration-restart]");

describe("Settings' switch for hardware acceleration", () => {
  it("is on by default and says a change waits for the app to start again, with Restart now where this page may restart it", async () => {
    await mount();
    expect(toggle()?.getAttribute("aria-checked")).toBe("true");
    await act(async () => { toggle()!.click(); await Promise.resolve(); });
    expect(set).toHaveBeenCalledWith(false);
    expect(toggle()?.getAttribute("aria-checked")).toBe("false");
    expect(note()?.textContent).toContain("Takes effect when");
    expect(note()?.textContent).toContain("restarts.");
    await act(async () => { note()!.querySelector("button")!.click(); });
    expect(relaunch).toHaveBeenCalledOnce();
  });

  it("drops the restart note once the switch is back the way the app started", async () => {
    await mount();
    await act(async () => { toggle()!.click(); await Promise.resolve(); });
    expect(note()).not.toBeNull();
    await act(async () => { toggle()!.click(); await Promise.resolve(); });
    expect(note()).toBeNull();
  });

  it("a server's page shows the note without a way to restart the app", async () => {
    Object.assign(window, { ogb: { hardwareAcceleration: { state: async () => saved, set } } });
    await mount();
    await act(async () => { toggle()!.click(); await Promise.resolve(); });
    expect(note()?.textContent).toContain("Takes effect when");
    expect(note()?.querySelector("button")).toBeNull();
  });

  it("is nowhere in a browser, an older app, or where this desktop always decides", async () => {
    delete (window as { ogb?: unknown }).ogb;
    await mount();
    expect(toggle()).toBeNull();
    await act(async () => root!.unmount());
    Object.assign(window, { ogb: { hardwareAcceleration: { state: async () => ({ on: false, restart: false, available: false }), set } } });
    await mount();
    expect(toggle()).toBeNull();
  });
});
