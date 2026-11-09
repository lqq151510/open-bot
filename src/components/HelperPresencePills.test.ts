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

  it("renders swarm board toggle button when active swarm with multiple agents is provided", () => {
    const helpers = [
      {
        id: "search-bot",
        name: "搜索助手",
        icon: "🔍",
        statusText: "正在检索文档...",
      },
    ];
    const swarm = {
      active: true,
      coordinator: {
        id: "openbot",
        name: "OpenBot",
        role: "参谋长",
        icon: "👑",
        status: "thinking" as const,
        statusText: "调度中",
        isCoordinator: true,
      },
      agents: [
        {
          id: "openbot",
          name: "OpenBot",
          role: "参谋长",
          icon: "👑",
          status: "thinking" as const,
          statusText: "调度中",
          isCoordinator: true,
        },
        {
          id: "search-bot",
          name: "搜索助手",
          role: "检索专家",
          icon: "🔍",
          status: "working" as const,
          statusText: "正在检索...",
        },
      ],
      steps: [],
      logs: [],
      progress: { completed: 1, total: 2, percentage: 50 },
    };

    const markup = renderToStaticMarkup(createElement(HelperPresencePills, { helpers, swarm }));
    expect(markup).toContain("协同看板");
    expect(markup).toContain("50%");
    expect(markup).toContain("data-testid=\"toggle-swarm-board-btn\"");
  });
});
