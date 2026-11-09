import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentSwarmBoard } from "./AgentSwarmBoard";
import type { SwarmState } from "@/lib/agent-swarm";

describe("AgentSwarmBoard", () => {
  const baseSwarm: SwarmState = {
    active: false,
    coordinator: null,
    agents: [],
    steps: [],
    logs: [],
    progress: { completed: 0, total: 0, percentage: 0 },
  };

  it("renders null when swarm is not active", () => {
    const markup = renderToStaticMarkup(createElement(AgentSwarmBoard, { swarm: baseSwarm }));
    expect(markup).toBe("");
  });

  it("renders null when there is only one agent", () => {
    const singleAgentSwarm: SwarmState = {
      ...baseSwarm,
      active: true,
      agents: [
        {
          id: "bot-1",
          name: "OpenBot",
          role: "参谋长 / 总编排",
          icon: "👑",
          status: "idle",
          statusText: "就绪",
        },
      ],
    };
    const markup = renderToStaticMarkup(createElement(AgentSwarmBoard, { swarm: singleAgentSwarm }));
    expect(markup).toBe("");
  });

  it("renders the active swarm board with multiple collaborating agents", () => {
    const activeSwarm: SwarmState = {
      active: true,
      coordinator: {
        id: "coord-1",
        name: "OpenBot",
        role: "参谋长 / 总编排",
        icon: "👑",
        status: "thinking",
        statusText: "编排调度中",
        isCoordinator: true,
      },
      agents: [
        {
          id: "coord-1",
          name: "OpenBot",
          role: "参谋长 / 总编排",
          icon: "👑",
          status: "thinking",
          statusText: "编排调度中",
          isCoordinator: true,
        },
        {
          id: "search-1",
          name: "SearchBot",
          role: "检索研究专家",
          icon: "🔍",
          status: "working",
          statusText: "正在检索文档...",
          currentTask: "调研 Grok 3 UI 规格",
        },
        {
          id: "code-1",
          name: "CodeBot",
          role: "代码架构师",
          icon: "💻",
          status: "done",
          statusText: "交付完成",
          currentTask: "实现 AgentSwarmBoard 前端组件",
        },
      ],
      steps: [
        {
          id: "step-1",
          title: "需求拆解与协同编排",
          assignedToId: "coord-1",
          assignedToName: "OpenBot",
          status: "completed",
        },
        {
          id: "step-2",
          title: "调研 Grok 3 规格",
          assignedToId: "search-1",
          assignedToName: "SearchBot",
          status: "running",
        },
      ],
      logs: [
        {
          id: "log-1",
          timestamp: 1000,
          fromAgent: "OpenBot",
          toAgent: "SearchBot",
          action: "派发任务",
          content: "调研 Grok 3 UI 规格与协议结构",
        },
      ],
      progress: { completed: 1, total: 2, percentage: 50 },
    };

    const markup = renderToStaticMarkup(
      createElement(AgentSwarmBoard, { swarm: activeSwarm, defaultExpanded: true }),
    );

    expect(markup).toContain("多智能体协同看板");
    expect(markup).toContain("3 个智能体协同");
    expect(markup).toContain("50%");
    expect(markup).toContain("OpenBot");
    expect(markup).toContain("SearchBot");
    expect(markup).toContain("CodeBot");
    expect(markup).toContain("检索研究专家");
    expect(markup).toContain("代码架构师");
    expect(markup).toContain("data-testid=\"agent-swarm-board\"");
  });
});
