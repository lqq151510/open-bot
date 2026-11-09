import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HelperPresencePills } from "./HelperPresencePills";

describe("HelperPresencePills", () => {
  it("renders null when there are no active helpers", () => {
    const markup = renderToStaticMarkup(createElement(HelperPresencePills, { helpers: [] }));
    expect(markup).toBe("");
  });

  it("renders floating pill for active search helper", () => {
    const helpers = [
      {
        id: "search-bot",
        name: "搜索助手",
        icon: "🔍",
        statusText: "正在检索文档...",
      },
    ];
    const markup = renderToStaticMarkup(createElement(HelperPresencePills, { helpers }));
    expect(markup).toContain("搜索助手");
    expect(markup).toContain("正在检索文档...");
    expect(markup).toContain("data-testid=\"helper-presence-pills\"");
    expect(markup).toContain("🔍");
  });

  it("renders multiple helper pills when multiple bots collaborate", () => {
    const helpers = [
      {
        id: "search-bot",
        name: "搜索助手",
        icon: "🔍",
        statusText: "正在检索文档...",
      },
      {
        id: "review-bot",
        name: "审查助手",
        icon: "💻",
        statusText: "正在审查代码...",
      },
    ];
    const markup = renderToStaticMarkup(createElement(HelperPresencePills, { helpers }));
    expect(markup).toContain("搜索助手");
    expect(markup).toContain("审查助手");
  });
});
