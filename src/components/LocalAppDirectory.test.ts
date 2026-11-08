import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { findLocalAppGroups } from "@/lib/local-app-directory";
import { LocalAppDirectory } from "./LocalAppDirectory";

describe("local app directory", () => {
  it.each(["飞书", "DingTalk", "Notion", "Google Calendar"])("finds %s without a connector service", name => {
    expect(findLocalAppGroups(name).flatMap(group => group.apps).some(app => app.includes(name))).toBe(true);
  });

  it("filters names without inventing a connected status", () => {
    const html = renderToStaticMarkup(createElement(LocalAppDirectory, { search: "Feishu", onManage: () => {} }));
    expect(html).toContain("Feishu");
    expect(html).not.toContain("DingTalk");
    expect(html).toContain("Set up MCP");
    expect(html).toContain("does not mean it is connected");
  });
});
