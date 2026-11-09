import { memo, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  GitFork,
  Sparkles,
  Terminal,
  Users,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { BotAvatar } from "@/components/Avatar";
import { WorkingDots } from "@/components/WorkingIndicator";
import type { SwarmAgent, SwarmState, SwarmStep } from "@/lib/agent-swarm";

export interface AgentSwarmBoardProps {
  swarm: SwarmState;
  defaultExpanded?: boolean;
  className?: string;
  onAgentClick?: (agent: SwarmAgent) => void;
  onStepClick?: (step: SwarmStep) => void;
}

export const AgentSwarmBoard = memo(function AgentSwarmBoard({
  swarm,
  defaultExpanded = false,
  className,
  onAgentClick,
  onStepClick,
}: AgentSwarmBoardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [activeTab, setActiveTab] = useState<"topology" | "pipeline" | "logs">("topology");

  if (!swarm.active || swarm.agents.length <= 1) {
    return null;
  }

  const { agents, steps, logs, progress } = swarm;
  const isAllDone = progress.total > 0 && progress.completed === progress.total;

  return (
    <div
      data-testid="agent-swarm-board"
      className={cn(
        "swarm-board-card my-2 w-full overflow-hidden rounded-2xl border border-hairline/60 bg-panel/90 shadow-md backdrop-blur-md transition-all duration-300",
        expanded && "ring-1 ring-accent/20",
        className,
      )}
    >
      {/* Header bar */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded(!expanded);
          }
        }}
        className="flex cursor-pointer items-center justify-between gap-3 px-3.5 py-2.5 transition-colors select-none hover:bg-raised/40"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="relative flex size-2.5 shrink-0" aria-hidden="true">
            {!isAllDone && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent/60 opacity-75" />
            )}
            <span
              className={cn(
                "relative inline-flex size-2.5 rounded-full",
                isAllDone ? "bg-emerald-500" : "bg-accent",
              )}
            />
          </span>

          <div className="flex items-center gap-2 truncate">
            <span className="flex items-center gap-1.5 text-[13px] font-semibold tracking-tight text-ink">
              <Sparkles size={14} className="text-accent shrink-0" />
              <span>多智能体协同看板</span>
            </span>

            <span className="hidden sm:inline-flex items-center rounded-full bg-control/60 px-2 py-0.5 text-[11px] font-medium text-ink-secondary">
              {agents.length} 个智能体协同
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {/* Progress pill */}
          <div className="flex items-center gap-1.5 text-[12px] font-mono text-ink-secondary">
            <div className="hidden sm:block h-1.5 w-16 overflow-hidden rounded-full bg-hairline/40">
              <div
                className={cn(
                  "h-full transition-all duration-500 rounded-full",
                  isAllDone ? "bg-emerald-500" : "bg-accent",
                )}
                style={{ width: `${progress.percentage}%` }}
              />
            </div>
            <span className="font-semibold text-ink">{progress.percentage}%</span>
            {progress.total > 0 && (
              <span className="text-[11px] text-ink-tertiary">
                ({progress.completed}/{progress.total})
              </span>
            )}
          </div>

          <button
            type="button"
            aria-label={expanded ? "收起看板" : "展开看板"}
            className="flex size-6 items-center justify-center rounded-md text-ink-tertiary hover:bg-raised hover:text-ink"
          >
            {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
        </div>
      </div>

      {/* Expanded detail panel */}
      {expanded && (
        <div className="border-t border-hairline/40 bg-inset/20 p-3.5 space-y-3">
          {/* Nav tabs */}
          <div className="flex items-center gap-1 border-b border-hairline/30 pb-2 text-[12px]">
            <button
              type="button"
              onClick={() => setActiveTab("topology")}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-medium transition-colors cursor-pointer",
                activeTab === "topology"
                  ? "bg-raised text-ink font-semibold shadow-xs"
                  : "text-ink-secondary hover:text-ink hover:bg-raised/40",
              )}
            >
              <Users size={13} />
              <span>编队拓扑 ({agents.length})</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("pipeline")}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-medium transition-colors cursor-pointer",
                activeTab === "pipeline"
                  ? "bg-raised text-ink font-semibold shadow-xs"
                  : "text-ink-secondary hover:text-ink hover:bg-raised/40",
              )}
            >
              <GitFork size={13} />
              <span>任务流转 ({steps.length})</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("logs")}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-medium transition-colors cursor-pointer",
                activeTab === "logs"
                  ? "bg-raised text-ink font-semibold shadow-xs"
                  : "text-ink-secondary hover:text-ink hover:bg-raised/40",
              )}
            >
              <Terminal size={13} />
              <span>协同流水 ({logs.length})</span>
            </button>
          </div>

          {/* Tab 1: Topology Roster */}
          {activeTab === "topology" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 pt-1">
              {agents.map((agent) => {
                const isWorking = agent.status === "working";
                const isDone = agent.status === "done";
                return (
                  <div
                    key={agent.id}
                    onClick={() => onAgentClick?.(agent)}
                    className={cn(
                      "flex flex-col gap-1.5 rounded-xl border border-hairline/40 bg-panel/70 p-2.5 transition-all shadow-xs",
                      isWorking && "border-accent/40 bg-raised/30 shadow-sm",
                      onAgentClick && "cursor-pointer hover:border-accent/60",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        {agent.bot ? (
                          <div className="shrink-0 size-6 flex items-center justify-center">
                            <BotAvatar bot={agent.bot} size={22} motion="none" animated={false} />
                          </div>
                        ) : (
                          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-control/60 text-[13px]">
                            {agent.icon}
                          </span>
                        )}

                        <div className="min-w-0">
                          <div className="flex items-center gap-1">
                            <span className="truncate text-[12.5px] font-semibold text-ink">
                              {agent.name}
                            </span>
                            {agent.isCoordinator && (
                              <span className="shrink-0 rounded bg-accent/15 px-1 py-0.2 text-[9.5px] font-bold text-accent">
                                参谋长
                              </span>
                            )}
                          </div>
                          <div className="truncate text-[11px] text-ink-tertiary">
                            {agent.role}
                          </div>
                        </div>
                      </div>

                      {/* State badge */}
                      <span
                        className={cn(
                          "shrink-0 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10.5px] font-medium",
                          isWorking && "bg-accent/15 text-accent animate-pulse",
                          isDone && "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
                          agent.status === "thinking" && "bg-amber-500/15 text-amber-600 dark:text-amber-400",
                          agent.status === "idle" && "bg-control/50 text-ink-tertiary",
                        )}
                      >
                        {isWorking && <WorkingDots size={2.5} />}
                        {isDone && <CheckCircle2 size={11} />}
                        {agent.status === "thinking" && <Clock size={11} />}
                        <span>
                          {isWorking ? "协同中" : isDone ? "交付完成" : agent.status === "thinking" ? "运算中" : "就绪"}
                        </span>
                      </span>
                    </div>

                    {agent.currentTask && (
                      <p className="line-clamp-2 text-[11px] leading-relaxed text-ink-secondary/80 bg-inset/40 rounded-md px-2 py-1">
                        {agent.currentTask}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Tab 2: Pipeline DAG */}
          {activeTab === "pipeline" && (
            <div className="space-y-2 pt-1">
              {steps.length === 0 ? (
                <div className="py-4 text-center text-[12px] text-ink-tertiary">
                  暂无独立拆解步骤
                </div>
              ) : (
                steps.map((step, idx) => {
                  const isDone = step.status === "completed";
                  const isRunning = step.status === "running";
                  return (
                    <div
                      key={step.id}
                      onClick={() => onStepClick?.(step)}
                      className={cn(
                        "relative flex items-center justify-between gap-3 rounded-xl border border-hairline/40 bg-panel/60 px-3 py-2 text-[12px] transition-all",
                        isRunning && "border-accent/40 bg-raised/40",
                        onStepClick && "cursor-pointer hover:border-accent/50",
                      )}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span
                          className={cn(
                            "flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
                            isDone && "bg-emerald-500 text-white",
                            isRunning && "bg-accent text-white animate-pulse",
                            step.status === "pending" && "bg-control text-ink-tertiary",
                          )}
                        >
                          {isDone ? <CheckCircle2 size={12} /> : idx + 1}
                        </span>

                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 truncate">
                            <span className="font-semibold text-ink">{step.title}</span>
                            <span className="text-[11px] text-ink-tertiary">·</span>
                            <span className="text-[11px] text-ink-secondary truncate">
                              @{step.assignedToName}
                            </span>
                          </div>
                          {step.summary && (
                            <p className="truncate text-[11px] text-ink-tertiary">
                              {step.summary}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="shrink-0 text-[11px]">
                        {isDone && (
                          <span className="text-emerald-600 dark:text-emerald-400 font-medium">已完成</span>
                        )}
                        {isRunning && (
                          <span className="text-accent font-medium flex items-center gap-1">
                            <WorkingDots size={2.5} /> 执行中
                          </span>
                        )}
                        {step.status === "pending" && (
                          <span className="text-ink-tertiary">等待中</span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* Tab 3: Swarm Communication Logs */}
          {activeTab === "logs" && (
            <div className="max-h-52 overflow-y-auto space-y-1.5 font-mono text-[11.5px] pr-1">
              {logs.length === 0 ? (
                <div className="py-4 text-center text-ink-tertiary font-sans">
                  暂无通信流水记录
                </div>
              ) : (
                logs.map((log) => (
                  <div
                    key={log.id}
                    className="flex items-start gap-2 rounded-lg bg-inset/50 p-2 text-ink-secondary leading-relaxed border border-hairline/20"
                  >
                    <span className="text-accent shrink-0 font-bold">[{log.action}]</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1 text-[10.5px] text-ink-tertiary">
                        <span className="font-semibold text-ink">{log.fromAgent}</span>
                        <ArrowRight size={10} className="shrink-0" />
                        <span className="font-semibold text-ink">{log.toAgent}</span>
                      </div>
                      <div className="mt-0.5 text-ink break-words font-sans text-[11px]">
                        {log.content}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
});
