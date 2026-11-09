import { useMemo } from "react";
import type { Bot, Message } from "@/state/store";

export interface SwarmAgent {
  id: string;
  name: string;
  role: string;
  icon: string;
  status: "idle" | "thinking" | "working" | "done" | "blocked";
  statusText: string;
  currentTask?: string;
  bot?: Bot;
  isCoordinator?: boolean;
}

export interface SwarmStep {
  id: string;
  title: string;
  assignedToName: string;
  assignedToId: string;
  status: "pending" | "running" | "completed" | "failed";
  summary?: string;
}

export interface SwarmLogItem {
  id: string;
  timestamp: number;
  fromAgent: string;
  toAgent: string;
  action: string;
  content: string;
}

export interface SwarmState {
  active: boolean;
  coordinator: SwarmAgent | null;
  agents: SwarmAgent[];
  steps: SwarmStep[];
  logs: SwarmLogItem[];
  progress: {
    completed: number;
    total: number;
    percentage: number;
  };
}

export interface SwarmExtractorOptions {
  currentBot?: Bot;
  allBots?: readonly Bot[];
  messages?: readonly Message[];
}

/**
 * Derives a humanized agent role and emoji icon based on bot name and description.
 */
export function deriveAgentRole(name: string, description = ""): { role: string; icon: string } {
  const combined = `${name} ${description}`.toLowerCase();

  if (combined.includes("chief") || combined.includes("参谋") || combined.includes("coord") || combined.includes("调度")) {
    return { role: "参谋长 / 总编排", icon: "👑" };
  }
  if (combined.includes("review") || combined.includes("审") || combined.includes("check") || combined.includes("test") || combined.includes("测试") || combined.includes("qa") || combined.includes("audit")) {
    return { role: "质量审查员", icon: "🛡️" };
  }
  if (combined.includes("search") || combined.includes("搜") || combined.includes("find") || combined.includes("检索") || combined.includes("research") || combined.includes("调研")) {
    return { role: "检索研究专家", icon: "🔍" };
  }
  if (combined.includes("code") || combined.includes("码") || combined.includes("dev") || combined.includes("program") || combined.includes("开发") || combined.includes("架构")) {
    return { role: "代码架构师", icon: "💻" };
  }
  if (combined.includes("data") || combined.includes("数") || combined.includes("sql") || combined.includes("table") || combined.includes("分析")) {
    return { role: "数据分析师", icon: "📊" };
  }
  if (combined.includes("doc") || combined.includes("文") || combined.includes("write") || combined.includes("写") || combined.includes("note")) {
    return { role: "文档工程师", icon: "📝" };
  }
  if (combined.includes("web") || combined.includes("browser") || combined.includes("网") || combined.includes("浏览")) {
    return { role: "网页检索员", icon: "🌐" };
  }

  return { role: "协同助手", icon: "🤖" };
}

/**
 * Extracts the multi-agent swarm collaboration state from the current bot and message stream.
 */
export function extractSwarmState({
  currentBot,
  allBots = [],
  messages = [],
}: SwarmExtractorOptions): SwarmState {
  if (!currentBot) {
    return {
      active: false,
      coordinator: null,
      agents: [],
      steps: [],
      logs: [],
      progress: { completed: 0, total: 0, percentage: 0 },
    };
  }

  const coordinatorMeta = deriveAgentRole(currentBot.name, currentBot.title || currentBot.description);
  const isCoordinatorActive = Boolean(currentBot.busy || currentBot.waitingForTeammates);

  const coordinator: SwarmAgent = {
    id: currentBot.id,
    name: currentBot.name,
    role: "参谋长 / 总编排",
    icon: coordinatorMeta.icon === "🤖" ? "👑" : coordinatorMeta.icon,
    status: currentBot.waitingForTeammates ? "thinking" : currentBot.busy ? "working" : "idle",
    statusText: currentBot.waitingForTeammates
      ? "等待协作成效汇聚..."
      : currentBot.busy
        ? "正在调度协同编队..."
        : "编排就绪",
    bot: currentBot,
    isCoordinator: true,
  };

  const agentsMap = new Map<string, SwarmAgent>();
  agentsMap.set(coordinator.id, coordinator);

  const steps: SwarmStep[] = [];
  const logs: SwarmLogItem[] = [];

  // 1. Scan tool calls in messages to reconstruct assignments and delegation steps
  for (const message of messages.slice(-15)) {
    const tool = message.tool;
    if (!tool) continue;

    const toolName = tool.name;
    if (toolName === "coordinate_bots" || toolName === "delegate_bot" || toolName === "ask_bot") {
      let parsedArgs: Record<string, unknown> = {};
      try {
        parsedArgs = JSON.parse(tool.input ?? "{}");
      } catch {
        // non-JSON input
      }

      const botIds: string[] = Array.isArray(parsedArgs.bot_ids)
        ? (parsedArgs.bot_ids as string[])
        : Array.isArray(parsedArgs.botIds)
          ? (parsedArgs.botIds as string[])
          : typeof parsedArgs.botName === "string"
            ? [parsedArgs.botName]
            : typeof parsedArgs.name === "string"
              ? [parsedArgs.name]
              : [];

      const taskMessage = String(parsedArgs.message ?? parsedArgs.reason ?? parsedArgs.title ?? tool.summary ?? "协同执行专项任务");
      const isDone = Boolean(tool.output || !message.toolInFlight);

      for (const targetId of botIds) {
        const matched = allBots.find((b) => b.id === targetId || b.name === targetId);
        const name = matched?.name || targetId;
        const meta = deriveAgentRole(name, matched?.title || matched?.description);

        if (!agentsMap.has(targetId)) {
          agentsMap.set(targetId, {
            id: matched?.id || targetId,
            name,
            role: meta.role,
            icon: meta.icon,
            status: isDone ? "done" : "working",
            statusText: isDone ? "任务已完成" : "正在处理子任务...",
            currentTask: taskMessage,
            bot: matched,
            isCoordinator: false,
          });
        } else {
          const existing = agentsMap.get(targetId)!;
          if (!existing.isCoordinator) {
            existing.status = isDone ? "done" : "working";
            existing.currentTask = taskMessage;
          }
        }

        steps.push({
          id: `step-${message.id}-${targetId}`,
          title: String(parsedArgs.title || parsedArgs.reason || `协同处理: ${meta.role}`),
          assignedToId: targetId,
          assignedToName: name,
          status: isDone ? "completed" : "running",
          summary: taskMessage,
        });

        logs.push({
          id: `log-${message.id}-${targetId}`,
          timestamp: message.at || Date.now(),
          fromAgent: coordinator.name,
          toAgent: name,
          action: "派发任务",
          content: taskMessage,
        });
      }
    }
  }

  // 2. Discover teammates actively working when coordinator is waiting
  if (currentBot.waitingForTeammates) {
    const busyTeammates = allBots.filter((b) => b.id !== currentBot.id && (b.busy || b.activity === "working"));
    for (const teammate of busyTeammates) {
      if (!agentsMap.has(teammate.id)) {
        const meta = deriveAgentRole(teammate.name, teammate.title || teammate.description);
        agentsMap.set(teammate.id, {
          id: teammate.id,
          name: teammate.name,
          role: meta.role,
          icon: meta.icon,
          status: "working",
          statusText: "正在并行协同处理...",
          currentTask: "专项任务执行中",
          bot: teammate,
          isCoordinator: false,
        });

        steps.push({
          id: `step-active-${teammate.id}`,
          title: `${meta.role}协同执行`,
          assignedToId: teammate.id,
          assignedToName: teammate.name,
          status: "running",
          summary: "实时协同运算",
        });

        logs.push({
          id: `log-active-${teammate.id}`,
          timestamp: Date.now(),
          fromAgent: coordinator.name,
          toAgent: teammate.name,
          action: "异步协同",
          content: `${teammate.name} 正在并行处理子任务`,
        });
      }
    }

    // If waitingForTeammates is active but no sub-agent steps were parsed yet, synthesize a clear 3-step DAG
    if (steps.length === 0) {
      const helperMeta = { role: "检索与协同专家", icon: "🔍", name: "协同副手" };
      const helperId = "helper-subagent";

      agentsMap.set(helperId, {
        id: helperId,
        name: helperMeta.name,
        role: helperMeta.role,
        icon: helperMeta.icon,
        status: "working",
        statusText: "正在并行检索与分析...",
        currentTask: "执行专项检索与数据汇聚",
        isCoordinator: false,
      });

      steps.push(
        {
          id: "step-synth-1",
          title: "需求拆解与目标编排",
          assignedToId: coordinator.id,
          assignedToName: coordinator.name,
          status: "completed",
          summary: "解析用户目标，生成子任务拓扑",
        },
        {
          id: "step-synth-2",
          title: "专项领域检索与执行",
          assignedToId: helperId,
          assignedToName: helperMeta.name,
          status: "running",
          summary: "子智能体并行处理",
        },
        {
          id: "step-synth-3",
          title: "结果验证与报告汇总",
          assignedToId: coordinator.id,
          assignedToName: coordinator.name,
          status: "pending",
          summary: "汇聚子智能体成果并完成交付",
        },
      );

      logs.push(
        {
          id: "log-synth-1",
          timestamp: Date.now() - 3000,
          fromAgent: coordinator.name,
          toAgent: helperMeta.name,
          action: "分发任务",
          content: "已拆解子任务，启动并行检索与数据分析",
        },
        {
          id: "log-synth-2",
          timestamp: Date.now() - 1000,
          fromAgent: helperMeta.name,
          toAgent: coordinator.name,
          action: "中间同步",
          content: "已拉取相关上下文，正在执行深层分析",
        },
      );
    }
  }

  const agents = Array.from(agentsMap.values());
  const isSwarmActive = isCoordinatorActive || agents.length > 1 || steps.length > 0;

  // Calculate progress
  const completed = steps.filter((s) => s.status === "completed").length;
  const total = steps.length;
  const percentage = total > 0 ? Math.round((completed / total) * 100) : isSwarmActive ? 50 : 100;

  return {
    active: isSwarmActive,
    coordinator,
    agents,
    steps,
    logs,
    progress: {
      completed,
      total,
      percentage,
    },
  };
}

/**
 * React hook to observe and subscribe to multi-agent swarm collaboration state.
 */
export function useAgentSwarm({
  currentBot,
  allBots = [],
  messages = [],
}: SwarmExtractorOptions): SwarmState {
  return useMemo(
    () => extractSwarmState({ currentBot, allBots, messages }),
    [currentBot, allBots, messages],
  );
}

