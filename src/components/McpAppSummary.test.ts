// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/i18n", () => ({ t: (key: string) => key }));
vi.mock("@/state/store", () => ({ api: vi.fn(async () => ({ ok: true, tools: [{ name: "read" }] })) }));
vi.mock("@/lib/mcp-servers", () => ({
  useMcpServers: () => ({ servers: [{ name: "github", enabled: true }, { name: "gmail", enabled: false }, { name: "custom-app", enabled: true }] }),
}));

import { McpAppSummary } from "./McpAppSummary";

describe("MCP app summary", () => {
  it("shows configured servers and their switch state without claiming a connection test passed", () => {
    const html = renderToStaticMarkup(createElement(McpAppSummary, { search: "", onManage: () => {} }));
    expect(html).toContain("github");
    expect(html).toContain("gmail");
    expect(html).toContain("custom-app");
    expect(html).toContain("mcp.badge.on");
    expect(html).toContain("mcp.badge.off");
    expect(html).not.toContain("server.mcp.testTools.many");
    expect(html).toMatch(/disabled=""/);
  });

  it("filters custom servers by name", () => {
    const html = renderToStaticMarkup(createElement(McpAppSummary, { search: "GIT", onManage: () => {} }));
    expect(html).toContain("github");
    expect(html).not.toContain("gmail");
    expect(html).not.toContain("custom-app");
  });

  it("shows a successful test only after the server responds", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(createElement(McpAppSummary, { search: "github", onManage: () => {} })));
    expect(container.textContent).not.toContain("server.mcp.testTools.many");
    const testButton = [...container.querySelectorAll("button")].find(button => button.textContent === "mcp.test")!;
    await act(async () => testButton.click());
    expect(container.textContent).toContain("server.mcp.testTools.many");
    await act(async () => root.unmount());
    container.remove();
  });
});
