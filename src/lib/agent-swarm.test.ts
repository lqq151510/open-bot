import { describe, expect, it } from "vitest";
import { deriveAgentRole, extractSwarmState } from "./agent-swarm";
import type { Bot, Message } from "@/state/store";

describe("agent-swarm", () => {
  describe("deriveAgentRole", () => {
    it("detects search and research agents", () => {
      expect(deriveAgentRole("SearchAssistant").role).toBe("检索研究专家");
      expect(deriveAgentRole("SearchAssistant").icon).toBe("🔍");
      expect(deriveAgentRole("文献检索员").role).toBe("检索研究专家");
    });

    it("detects code and developer agents", () => {
      expect(deriveAgentRole("CodeBot").role).toBe("代码架构师");
      expect(deriveAgentRole("CodeBot").icon).toBe("💻");
    });

    it("detects review and test agents", () => {
      expect(deriveAgentRole("CodeReviewer").role).toBe("质量审查员");
      expect(deriveAgentRole("CodeReviewer").icon).toBe("🛡️");
    });

    it("detects data and doc agents", () => {
      expect(deriveAgentRole("SqlAnalyst").role).toBe("数据分析师");
      expect(deriveAgentRole("SqlAnalyst").icon).toBe("📊");
      expect(deriveAgentRole("DocWriter").role).toBe("文档工程师");
      expect(deriveAgentRole("DocWriter").icon).toBe("📝");
    });

    it("falls back to default helper", () => {
      expect(deriveAgentRole("RandomBot").role).toBe("协同助手");
      expect(deriveAgentRole("RandomBot").icon).toBe("🤖");
    });
  });

  describe("extractSwarmState", () => {
    const makeBot = (partial: Partial<Bot>): Bot => ({
      id: "bot-1",
      name: "OpenBot",
      title: "参谋长",
      description: "智能编排参谋长",
      threadId: "thread-1",
      notifications: false,
      color: "blue" as const,
      unread: false,
      modelSelection: { model: "default" },
      ...partial,
    });

    it("returns inactive state if no currentBot", () => {
      const state = extractSwarmState({});
      expect(state.active).toBe(false);
      expect(state.coordinator).toBeNull();
      expect(state.agents).toEqual([]);
      expect(state.steps).toEqual([]);
    });

    it("parses single idle coordinator", () => {
      const bot = makeBot({ name: "OpenBot", busy: false });
      const state = extractSwarmState({ currentBot: bot });
      expect(state.coordinator?.name).toBe("OpenBot");
      expect(state.coordinator?.role).toBe("参谋长 / 总编排");
      expect(state.agents.length).toBe(1);
      expect(state.steps.length).toBe(0);
    });

    it("synthesizes multi-step DAG when waitingForTeammates is true", () => {
      const bot = makeBot({ name: "OpenBot", waitingForTeammates: true });
      const state = extractSwarmState({ currentBot: bot });
      expect(state.active).toBe(true);
      expect(state.coordinator?.status).toBe("thinking");
      expect(state.agents.length).toBeGreaterThan(1);
      expect(state.steps.length).toBe(3);
      expect(state.steps[0].title).toBe("需求拆解与目标编排");
      expect(state.steps[1].title).toBe("专项领域检索与执行");
      expect(state.logs.length).toBeGreaterThan(0);
    });

    it("extracts sub-agents and steps from coordinate_bots tool message", () => {
      const coordinator = makeBot({ id: "coord-1", name: "参谋长" });
      const searcherBot = makeBot({ id: "search-1", name: "SearchBot", title: "检索专家" });
      const coderBot = makeBot({ id: "coder-1", name: "CoderBot", title: "代码架构师" });

      const messages: Message[] = [
        {
          id: "m-1",
          role: "bot",
          kind: "tool",
          at: 1000,
          tool: {
            name: "coordinate_bots",
            input: JSON.stringify({
              bot_ids: ["search-1", "coder-1"],
              title: "实现多智能体看板",
              message: "由检索员收集上下文，代码专家实现看板",
            }),
            summary: "Hand task to SearchBot and CoderBot",
          },
        },
      ];

      const state = extractSwarmState({
        currentBot: coordinator,
        allBots: [coordinator, searcherBot, coderBot],
        messages,
      });

      expect(state.active).toBe(true);
      expect(state.agents.length).toBe(3);
      expect(state.steps.length).toBe(2);
      expect(state.steps[0].assignedToName).toBe("SearchBot");
      expect(state.steps[1].assignedToName).toBe("CoderBot");
      expect(state.logs.length).toBe(2);
    });
  });
});
