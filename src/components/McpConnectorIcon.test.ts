import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { McpConnectorIcon } from "./McpConnectorIcon";

describe("MCP connector icons", () => {
  it.each([
    "github", "gmail", "kaixin-shared-memory", "playwright", "context7", "apifox-local",
    "ollama-local", "ffmpeg-video", "cursor-model-router", "browser-playwright", "context7-local",
    "firecrawl", "tavily-search", "serena", "computer-use", "node_repl", "blender", "rea",
    "huggingface-hub", "stitch",
  ])("recognizes %s without requesting an external icon", (name) => {
    const html = renderToStaticMarkup(createElement(McpConnectorIcon, { name }));
    expect(html).not.toContain('data-mcp-icon="other"');
    expect(html).not.toContain("https://");
  });

  it("falls back safely for unknown custom servers", () => {
    const html = renderToStaticMarkup(createElement(McpConnectorIcon, { name: "personal-server" }));
    expect(html).toContain('data-mcp-icon="other"');
  });
});
