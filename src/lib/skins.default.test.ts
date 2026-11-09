import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const values = new Map<string, string>();
const os = { dark: false, listeners: new Set<() => void>() };

// Each case loads fresh modules over the same storage, as a launch would; interface-mode keeps a per-session choice.
async function boot() {
  vi.resetModules();
  const [{ settleAdvancedModeDefault, readAdvancedMode }, skins] = await Promise.all([import("./interface-mode"), import("./skins")]);
  settleAdvancedModeDefault();
  skins.applySkinChoice(skins.readSkinChoice());
  return { skin: document.documentElement.dataset.skin, advanced: readAdvancedMode(), stored: values.get("omb-skin") };
}

function setOsDark(dark: boolean) {
  os.dark = dark;
  for (const listener of os.listeners) listener();
}

beforeEach(() => {
  values.clear();
  os.dark = false;
  os.listeners.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  });
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("document", { documentElement: { dataset: {} as Record<string, string> } });
  vi.stubGlobal("matchMedia", (query: string) => ({
    get matches() { return query === "(prefers-color-scheme: dark)" && os.dark; },
    addEventListener: (_type: string, listener: () => void) => { os.listeners.add(listener); },
    removeEventListener: (_type: string, listener: () => void) => { os.listeners.delete(listener); },
  }));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("default skin", () => {
  it("opens a fresh install in Light, regardless of the computer setting", async () => {
    expect(await boot()).toEqual({ skin: "daylight", advanced: false, stored: "daylight" });
    values.set("omb-installed", "2026-10-17T00:00:00.000Z");
    os.dark = true;
    expect(await boot()).toEqual({ skin: "daylight", advanced: false, stored: "daylight" });
  });

  it("switches between Daylight and Midnight when Follow system is selected", async () => {
    const skins = await import("./skins");
    skins.applySkinChoice("system");
    setOsDark(true);
    expect(document.documentElement.dataset.skin).toBe("midnight");
    setOsDark(false);
    expect(document.documentElement.dataset.skin).toBe("daylight");
    expect((await import("./skins")).readSkinChoice()).toBe("system");
  });

  it("migrates the old implicit System default to Light once", async () => {
    values.set("omb-skin", "system");
    expect(await boot()).toMatchObject({ skin: "daylight", stored: "daylight" });
    const skins = await import("./skins");
    skins.applySkinChoice("system");
    expect(skins.readSkinChoice()).toBe("system");
  });

  it("stops following the computer once someone picks a skin", async () => {
    await boot();
    const skins = await import("./skins");
    skins.applySkin("meadow");
    setOsDark(true);
    expect(document.documentElement.dataset.skin).toBe("meadow");
    expect(values.get("omb-skin")).toBe("meadow");
  });

  it("keeps an explicitly saved dark choice", async () => {
    values.set("omb-skin", "midnight");
    expect(await boot()).toMatchObject({ skin: "midnight", stored: "midnight" });
  });

  it("defaults an earlier install with no valid saved skin to Light", async () => {
    values.set("omb-installed", "2026-01-01T00:00:00.000Z");
    expect(await boot()).toEqual({ skin: "daylight", advanced: true, stored: "daylight" });
    values.set("omb-skin", "retired-skin");
    expect(await boot()).toMatchObject({ skin: "daylight", stored: "daylight" });
  });

  it("always honours a skin someone chose", async () => {
    values.set("omb-skin", "lagoon");
    expect(await boot()).toMatchObject({ skin: "lagoon" });
    values.clear();
    values.set("omb-skin", "midnight");
    values.set("omb-advanced-mode", "0");
    expect(await boot()).toMatchObject({ skin: "midnight", advanced: false });
  });

  it("shows Light as the theme and Daylight as the selected look on a fresh install", async () => {
    os.dark = true;
    await boot();
    const [{ SkinPicker }, { ThemeRow }] = await Promise.all([import("@/components/SkinPicker"), import("@/components/ThemeRow")]);
    const picker = renderToStaticMarkup(createElement(SkinPicker));
    const pressed = [...picker.matchAll(/aria-pressed="true"[\s\S]*?<div class="text-\[13px\] font-medium text-ink">([^<]+)</g)].map(([, name]) => name);
    expect(pressed).toEqual(["Daylight"]);
    const theme = renderToStaticMarkup(createElement(ThemeRow));
    expect([...theme.matchAll(/aria-checked="true"[^>]*>([^<]+)</g)].map(([, label]) => label)).toEqual(["Light"]);
    expect(theme).toContain(">System</button>");
    expect(theme).toContain(">Dark</button>");
  });
});
