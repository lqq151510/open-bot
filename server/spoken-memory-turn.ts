import type { AboutMe } from "./about-me.ts";
import { botMemoryUpdate, ownersOwnAsk, type PreferenceTarget } from "./memory-forget.ts";
import { spokenMemoryToApply, type SpokenMemoryHarness } from "./memory-spoken.ts";
import type { BotRecord } from "./store.ts";
import { memorySourceLabel } from "./workspace.ts";

export interface SpokenMemoryTurn extends SpokenMemoryHarness {
  bot: BotRecord;
  threadId: string;
  generation: string;
  text: string;
}

export interface SpokenMemoryDeps {
  cloudTeam: boolean;
  groupByThread(threadId: string): { name: string } | undefined;
  activePath(threadId: string): Parameters<typeof ownersOwnAsk>[0];
  taskByThread(botId: string, threadId: string): { title: string } | undefined;
  layer(botId: string, threadId: string): string;
  aboutMe: Pick<AboutMe, "forget"> | null;
  preferTarget(threadId: string, generation: string, bot: BotRecord): PreferenceTarget | null;
}

export function applySpokenMemory(input: SpokenMemoryTurn, deps: SpokenMemoryDeps): void {
  const command = spokenMemoryToApply(input, input.text);
  if (!command) return;
  const room = deps.groupByThread(input.threadId);
  const ownersAsk = deps.cloudTeam || (!room && ownersOwnAsk(deps.activePath(input.threadId)));
  botMemoryUpdate(deps.layer(input.bot.id, input.threadId), command, {
    source: memorySourceLabel({ room, task: deps.taskByThread(input.bot.id, input.threadId), threadId: input.threadId }),
    aboutMe: ownersAsk ? deps.aboutMe : null,
    prefer: command.action === "prefer" ? deps.preferTarget(input.threadId, input.generation, input.bot) : null,
  });
}
