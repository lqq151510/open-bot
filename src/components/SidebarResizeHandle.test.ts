// @vitest-environment happy-dom
import { act, createElement, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import { SIDEBAR_WIDTH_KEY, SIMPLE_SIDEBAR_WIDTH_KEY } from "@/lib/sidebar-preferences";
import { AVATARS_BELOW, nextEdgeDrag, SidebarResizeHandle, useSidebarWidth } from "./SidebarResizeHandle";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The sidebar starts this far from the window's left edge, beside the window's rail. */
const LEFT = 36;
let host: HTMLDivElement, root: Root | null = null;
let seen: boolean[];

type HarnessProps = { avatars: boolean; simple?: boolean; sidePanelOpen?: boolean };

function Harness({ avatars: startAvatars, simple = false, sidePanelOpen = false }: HarnessProps) {
  const sidebarRef = useRef<HTMLElement>(null);
  const [avatars, setAvatars] = useState(startAvatars);
  const sizing = useSidebarWidth({ simple, sidePanelOpen, sidebarRef });
  return createElement("aside", { ref: sidebarRef, "data-sidebar": "", style: { "--sidebar-width": `${sizing.width}px` } },
    createElement(SidebarResizeHandle, { sizing, sidebarRef, avatars, avatarsWidth: 80, onAvatars: (next: boolean) => { seen.push(next); setAvatars(next); } }));
}

async function mount(avatars = false, options: Omit<HarnessProps, "avatars"> = {}) {
  root = createRoot(host);
  await act(async () => root!.render(createElement(Harness, { avatars, ...options })));
}
const sidebar = () => host.querySelector<HTMLElement>("[data-sidebar]")!;
const edge = () => host.querySelector<HTMLElement>("[data-sidebar-resize]")!;
const width = () => sidebar().style.getPropertyValue("--sidebar-width");
const pointer = (type: string, at: number) => act(async () => {
  edge().dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientX: LEFT + at }));
});
const key = async (name: string) => {
  const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true });
  await act(async () => { edge().dispatchEvent(event); });
  return event;
};

beforeEach(() => {
  setLocale("en");
  const saved = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (name: string) => saved.get(name) ?? null, setItem: (name: string, value: string) => { saved.set(name, value); } });
  seen = [];
  host = document.createElement("div");
  document.body.append(host);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const wide = this.hasAttribute("data-sidebar") ? Number.parseFloat(this.style.getPropertyValue("--sidebar-width")) || 0 : 0;
    return { left: LEFT, top: 0, width: wide, height: 800, right: LEFT + wide, bottom: 800, x: LEFT, y: 0, toJSON() {} } as DOMRect;
  });
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("a drag of the sidebar's edge", () => {
  it("is the column of avatars below its threshold, and open above it: at the width it had until the pointer reaches that edge", () => {
    const open = { avatars: false, following: true };
    expect(nextEdgeDrag(open, 300, 320)).toEqual(open);
    expect(nextEdgeDrag(open, AVATARS_BELOW - 1, 320)).toEqual({ avatars: true, following: false });
    const opened = nextEdgeDrag({ avatars: true, following: false }, AVATARS_BELOW, 320);
    expect(opened).toEqual({ avatars: false, following: false });
    expect(nextEdgeDrag(opened, 250, 320), "short of the edge it opened at").toEqual({ avatars: false, following: false });
    expect(nextEdgeDrag(opened, 320, 320)).toEqual({ avatars: false, following: true });
  });

  it("narrower than the threshold, becomes the column of avatars, and the sidebar keeps the width it had for when it opens", async () => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, "320");
    await mount();
    await pointer("pointerdown", 320);
    expect(edge().getAttribute("data-sidebar-resize"), "the edge is marked while it is dragged").toBe("dragging");
    expect(document.body.style.cursor, "the whole page shows the resize cursor").toBe("col-resize");
    expect(document.body.style.userSelect).toBe("none");
    await pointer("pointermove", 260);
    expect(width()).toBe("260px");
    await pointer("pointermove", 100);
    expect(seen).toEqual([true]);
    expect(width(), "back to the width it had").toBe("320px");
    await pointer("pointerup", 100);
    expect(localStorage.getItem(SIDEBAR_WIDTH_KEY)).toBe("320");
    expect(edge().getAttribute("data-sidebar-resize")).toBe("");
    expect(document.body.style.cursor, "and lets it go when the drag ends").toBe("");
    expect(document.body.style.userSelect).toBe("");
  });

  it("out of the column of avatars, opens the sidebar at its last width, then follows the pointer past that edge, and keeps where it is left", async () => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, "300");
    await mount(true);
    expect(edge().getAttribute("aria-valuenow"), "as avatars, the edge reports the column's width").toBe("80");
    await pointer("pointerdown", 80);
    await pointer("pointermove", AVATARS_BELOW - 10);
    expect(seen).toEqual([]);
    await pointer("pointermove", 200);
    expect(seen).toEqual([false]);
    expect(width()).toBe("300px");
    await pointer("pointermove", 250);
    expect(width(), "the pointer hasn't reached the open sidebar's edge").toBe("300px");
    await pointer("pointermove", 340);
    expect(width()).toBe("340px");
    await pointer("pointerup", 340);
    expect(localStorage.getItem(SIDEBAR_WIDTH_KEY)).toBe("340");
  });

  it("goes back to the avatars and out again in one drag", async () => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, "320");
    await mount();
    await pointer("pointerdown", 320);
    await pointer("pointermove", 120);
    await pointer("pointermove", 220);
    expect(seen).toEqual([true, false]);
    expect(width()).toBe("320px");
    await pointer("pointerup", 220);
    expect(localStorage.getItem(SIDEBAR_WIDTH_KEY)).toBe("320");
  });

  it("left open, keeps the width it leaves", async () => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, "320");
    await mount();
    await pointer("pointerdown", 320);
    await pointer("pointermove", 280);
    await pointer("pointerup", 280);
    expect(seen).toEqual([]);
    expect(localStorage.getItem(SIDEBAR_WIDTH_KEY)).toBe("280");
  });
});

describe("the sidebar's edge from the keyboard", () => {
  it("steps narrower to the open sidebar's narrowest, then to the avatars, and the right arrow opens it again", async () => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, "256");
    await mount();
    await key("ArrowLeft");
    expect(width()).toBe("240px");
    expect(seen).toEqual([]);
    await key("ArrowLeft");
    expect(seen).toEqual([true]);
    await key("ArrowRight");
    expect(seen).toEqual([true, false]);
    expect(width()).toBe("240px");
  });

  it("collapses immediately with Home and keeps the expanded width", async () => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, "360");
    await mount();
    edge().focus();
    expect(document.activeElement).toBe(edge());
    expect((await key("Home")).defaultPrevented).toBe(true);
    await key("Home");
    expect(seen).toEqual([true]);
    expect(edge().getAttribute("aria-valuenow")).toBe("80");
    expect(localStorage.getItem(SIDEBAR_WIDTH_KEY)).toBe("360");
    await key("ArrowRight");
    expect(edge().getAttribute("aria-valuenow")).toBe("360");
  });

  it.each([false, true])("expands to the available maximum with End (avatars: %s)", async (avatars) => {
    vi.stubGlobal("innerWidth", 768);
    localStorage.setItem(SIDEBAR_WIDTH_KEY, "300");
    await mount(avatars);
    expect((await key("End")).defaultPrevented).toBe(true);
    expect(seen).toEqual(avatars ? [false] : []);
    expect(edge().getAttribute("aria-valuenow")).toBe("448");
    expect(edge().getAttribute("aria-valuemax")).toBe("448");
    expect(localStorage.getItem(SIDEBAR_WIDTH_KEY)).toBe("448");
    expect((await key("Tab")).defaultPrevented).toBe(false);
  });

  it("keeps the wide Simple preference when the viewport narrows and restores it on reload", async () => {
    vi.stubGlobal("innerWidth", 1800);
    await mount(false, { simple: true });
    await key("End");
    expect(edge().getAttribute("aria-valuenow")).toBe("560");
    expect(localStorage.getItem(SIMPLE_SIDEBAR_WIDTH_KEY)).toBe("560");

    await act(async () => {
      vi.stubGlobal("innerWidth", 1280);
      window.dispatchEvent(new Event("resize"));
    });
    expect(edge().getAttribute("aria-valuemax")).toBe("400");
    expect(width()).toBe("400px");
    await key("End");
    expect(localStorage.getItem(SIMPLE_SIDEBAR_WIDTH_KEY)).toBe("560");

    await act(async () => root!.unmount());
    vi.stubGlobal("innerWidth", 1800);
    await mount(false, { simple: true });
    expect(width()).toBe("560px");
  });

  it("keeps the larger saved width when a details panel caps End", async () => {
    vi.stubGlobal("innerWidth", 1280);
    localStorage.setItem(SIDEBAR_WIDTH_KEY, "460");
    await mount(true, { sidePanelOpen: true });
    await key("End");
    expect(seen).toEqual([false]);
    expect(edge().getAttribute("aria-valuenow")).toBe("320");
    expect(width()).toBe("320px");
    expect(localStorage.getItem(SIDEBAR_WIDTH_KEY)).toBe("460");
    await act(async () => root!.render(createElement(Harness, { avatars: false })));
    expect(edge().getAttribute("aria-valuenow")).toBe("460");
    expect(width()).toBe("460px");
  });
});
