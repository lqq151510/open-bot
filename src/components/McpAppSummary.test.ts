import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/i18n", () => ({ t: (key: string) => key }));
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
});
