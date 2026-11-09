// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalAppDirectory } from "./LocalAppDirectory";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("local app directory navigation", () => {
  let cleanup: (() => void) | undefined;
  afterEach(() => { cleanup?.(); cleanup = undefined; });

  it("filters by category and opens MCP settings on request", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    cleanup = () => { act(() => root.unmount()); container.remove(); };
    const onManage = vi.fn();
    await act(async () => root.render(createElement(LocalAppDirectory, { search: "", onManage })));
    const button = (label: string) => [...container.querySelectorAll("button")].find(item => item.textContent === label);
    expect(container.textContent).toContain("DingTalk");
    await act(async () => button("Design")!.click());
    expect(container.textContent).toContain("Figma");
    expect(container.textContent).not.toContain("DingTalk");
    const setup = container.querySelector<HTMLButtonElement>('button[aria-label="Set up MCP Figma"]');
    expect(setup).not.toBeNull();
    await act(async () => setup!.click());
    expect(onManage).toHaveBeenCalledOnce();
  });

  it("uses the parent category and sends View all back to the parent", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    cleanup = () => { act(() => root.unmount()); container.remove(); };
    const onCategoryChange = vi.fn();
    await act(async () => root.render(createElement(LocalAppDirectory, { search: "", onManage: () => {}, onCategoryChange })));
    expect(container.querySelector('[aria-label="App categories"]')).toBeNull();
    const viewAll = [...container.querySelectorAll("button")].find(item => item.textContent === "View category");
    expect(viewAll).toBeDefined();
    await act(async () => viewAll!.click());
    expect(onCategoryChange).toHaveBeenCalledWith("Productivity");
    await act(async () => root.render(createElement(LocalAppDirectory, { search: "", onManage: () => {}, onCategoryChange, externalCategory: "Design" })));
    expect(container.textContent).toContain("Figma");
    expect(container.textContent).not.toContain("DingTalk");
  });
});
