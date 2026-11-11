import { describe, expect, it } from "vitest";
import { conversationRoutineItems, postedRoutineRunIds, type ConversationRoutineRef, type ConversationRunRef } from "./conversation-routines";

const routine = (patch: Partial<ConversationRoutineRef> = {}): ConversationRoutineRef => ({
  id: "morning", name: "Morning", botId: "atlas", createdAt: 10, ...patch,
});

const run = (patch: Partial<ConversationRunRef> = {}): ConversationRunRef => ({
  id: "run-1", routineId: "morning", routineName: "Morning", botId: "atlas", status: "running",
  createdAt: 20, scheduledFor: 20, ...patch,
});

const view = (patch: Partial<Parameters<typeof conversationRoutineItems>[0]> = {}) => conversationRoutineItems({
  threadId: "chat", botId: "atlas", mainThreadId: "chat", routines: [], runs: [], postedRunIds: new Set(), ...patch,
});

describe("conversationRoutineItems", () => {
  it("shows a routine created in this conversation, then its latest run", () => {
    const created = view({
      routines: [routine({ sourceThreadId: "chat" })],
    });
    expect(created).toEqual([{ kind: "created", routineId: "morning", botId: "atlas", name: "Morning", at: 10 }]);

    const running = view({
      routines: [routine({ sourceThreadId: "chat" })],
      runs: [run({ status: "completed", createdAt: 20 }), run({ id: "run-2", status: "running", createdAt: 30 })],
    });
    expect(running.map((item) => item.kind === "run" ? item.run.id : item.kind)).toEqual(["created", "run-2"]);
  });

  it("does not repeat a run that is already a card in the transcript", () => {
    const items = view({
      routines: [routine({ sourceThreadId: "chat" })],
      runs: [run()],
      postedRunIds: postedRoutineRunIds([{ kind: "routine.run", routineRun: { runId: "run-1" } }]),
    });
    expect(items).toEqual([]);
  });

  it("shows a live run on the bot's main conversation even when it was not created there", () => {
    const items = view({
      threadId: "chat",
      mainThreadId: "chat",
      routines: [routine()],
      runs: [run({ status: "waiting" })],
    });
    expect(items).toMatchObject([{ kind: "run", run: { id: "run-1", status: "waiting" } }]);
    expect(view({ threadId: "other", mainThreadId: "chat", routines: [routine()], runs: [run()] })).toEqual([]);
  });

  it("in a room, only shows routines aimed at that conversation", () => {
    const items = view({
      botId: null,
      threadId: "room",
      mainThreadId: "room",
      routines: [routine({ sourceThreadId: "room" }), routine({ id: "other", name: "Other" })],
      runs: [run({ sourceThreadId: "room", status: "queued" })],
    });
    expect(items.map((item) => `${item.kind}:${item.routineId}`)).toEqual(["created:morning", "run:morning"]);
  });
});
