// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, initialState, StoreContext, type Message } from "@/state/store";
import { setAdvancedMode } from "@/lib/interface-mode";

const fixture = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  dispatch: vi.fn(),
  api: vi.fn(async (..._args: unknown[]) => ({}) as unknown),
}));
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  useStore: () => ({ state: fixture.state, dispatch: fixture.dispatch }),
  api: (...args: unknown[]) => fixture.api(...args),
}));
vi.mock("@/lib/thread-preferences", () => ({ useShowThreads: () => false }));

const { ApprovalCard } = await import("./ApprovalCard");

const now = Date.now();
const bot = { id: "bot-1", name: "Scout", hidden: false };
const routine = {
  id: "routine-1", name: "Morning brief", prompt: "Summarize the inbox and post the three priorities.", target: "bot", botId: "bot-1", runOn: "maus",
  enabled: true, schedule: { type: "daily", time: "09:00", weekdays: [1, 2, 3, 4, 5] }, durationMinutes: 30, nextRunAt: now + 3_600_000,
  createdAt: now, updatedAt: now,
};
const webhook = {
  id: "hook-1", endpointId: "wh_abc", name: "Interested replies", prompt: "Draft a follow-up for the lead.", botId: "bot-1", runOn: "maus",
  enabled: true, createdAt: now, updatedAt: now, deliveryCount: 0,
};
const base = { version: 1 as const, requestId: "request-1", botId: "bot-1", threadId: "thread-1", createdAt: now };
function card(extra: Partial<NonNullable<Message["card"]>>): Message {
  return {
    id: "card-1", role: "bot", kind: "options", at: now,
    card: { title: "Trigger", subtitle: "", options: [], answered: "allow", dismissed: true, autoApplied: true, requestId: "request-1", ...extra },
  };
}
const scheduleCard = card({ tool: "schedule_routine", routineRequest: { ...base, resultId: "routine-1", operation: { action: "create", routine: {
  name: "Morning brief", instructions: routine.prompt, schedule: { type: "daily", time: "09:00", weekdays: [1, 2, 3, 4, 5] }, runOn: "maus", durationMinutes: 30,
} }, undo: { name: "Morning brief" } } });
const updateCard = card({ tool: "manage_routine", routineRequest: { ...base, operation: {
  action: "update", routineId: routine.id, expectedUpdatedAt: now, changes: { name: "Renamed brief" },
}, undo: { name: "Renamed brief" } } });
const webhookCard = card({ tool: "create_trigger", webhookRequest: { ...base, resultId: "hook-1", operation: { action: "create", webhook: { name: "Interested replies", instructions: webhook.prompt, runOn: "maus" } }, undo: { name: "Interested replies" } } });

const render = (message: Message) => renderToStaticMarkup(createElement(ApprovalCard, { bot: { name: "Scout" }, message, threadId: "thread-1" }));
let root: Root | null = null;
let host: HTMLDivElement;
const renderMounted = (message: Message) => flushSync(() => root!.render(createElement(StoreContext.Provider, {
  value: {
    state: { ...initialState, ...fixture.state }, dispatch: fixture.dispatch,
    flushBotPatches: vi.fn(async () => null), refreshInstances: vi.fn(async () => {}), refreshModels: vi.fn(async () => {}),
  },
}, createElement(ApprovalCard, { bot: { name: "Scout" }, message, threadId: "thread-1" }))));
function mount(message: Message) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  renderMounted(message);
  return host;
}
function click(message: Message, ...labels: string[]) {
  const container = mount(message);
  for (const label of labels) {
    const button = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === label || candidate.getAttribute("aria-label") === label);
    if (!button) throw new Error(`no ${label} button in ${container.innerHTML}`);
    flushSync(() => button.click());
  }
  return container;
}
afterEach(() => { root?.unmount(); root = null; document.body.innerHTML = ""; });

beforeEach(() => {
  setAdvancedMode(false);
  fixture.dispatch.mockReset();
  fixture.api.mockReset();
  fixture.api.mockResolvedValue({});
  fixture.state = { bots: [bot], selectedId: bot.id, routines: [routine], webhooks: [webhook], routineRuns: [], routinesLoadState: "ready" };
});

describe("the chat card a bot-made automation leaves", () => {
  const sentence = "Every weekday at 9 AM, Scout summarizes the inbox and posts the three priorities";

  it("says what was set up in one sentence, what happens next, and offers Pause, Edit and Undo — never a confirmation", () => {
    const html = click(scheduleCard, "Details").innerHTML;
    expect(html).toContain('data-trigger-card="routine-1"');
    expect(html).toContain(sentence);
    expect(html).toMatch(/First run (today|tomorrow|[A-Z][a-z]+day) \d/);
    expect(html).not.toContain("Next: ");
    expect(html).not.toMatch(/hasn(&#x27;|')t run yet/);
    for (const label of ["Pause", "Edit", "Undo"]) expect(html).toContain(`${label}</button>`);
    expect(html).not.toMatch(/TRIGGER ON|Trigger on|Open in Triggers|Confirm/);
  });

  it("updates as runs come in: last ran, its one-line result and the next run, on one line", () => {
    fixture.state.routineRuns = [
      { id: "run-2", routineId: "routine-1", botId: "bot-1", status: "completed", scheduledFor: now - 60_000, startedAt: now - 60_000, createdAt: now - 60_000, threadId: "exec-2", output: "Three priorities: invoices, hiring, launch.\nMore detail." },
    ];
    const html = click(scheduleCard, "Details").innerHTML;
    expect(html).toMatch(/Last ran today [^<]* ✓ Three priorities: invoices, hiring, launch\. · next: /);
    expect(html).not.toContain("More detail.");
    expect(html).not.toContain("Next: ");
  });

  it("pauses through its own API, applies the answer at once, and says Paused with Resume once paused", async () => {
    fixture.api.mockResolvedValue({ routine: { ...routine, enabled: false } });
    click(scheduleCard, "Details", "Pause");
    await vi.waitFor(() => expect(fixture.dispatch).toHaveBeenCalledWith({ type: "routinePatched", routine: { ...routine, enabled: false } }));
    expect(fixture.api).toHaveBeenCalledWith("/api/routines/routine-1", { method: "PATCH", body: JSON.stringify({ enabled: false }) });
    fixture.state.routines = [{ ...routine, enabled: false }];
    renderMounted(scheduleCard);
    expect(host.innerHTML).toContain(">Paused<");
    expect(host.innerHTML).toContain("Resume</button>");
  });

  it("says why when turning it back on is refused", async () => {
    fixture.state.routines = [{ ...routine, enabled: false }];
    fixture.api.mockRejectedValue(new Error("Its time has passed. Edit it to pick a new time."));
    click(scheduleCard, "Details", "Resume");
    await vi.waitFor(() => expect(document.querySelector("[role=alert]")?.textContent).toBe("Its time has passed. Edit it to pick a new time."));
  });

  it("says Done, with no Pause or Resume, once a one-time automation has happened", () => {
    fixture.state.routines = [{ ...routine, enabled: false, nextRunAt: null, schedule: { type: "once", at: now - 60_000 } }];
    fixture.state.routineRuns = [{ id: "run-4", routineId: "routine-1", botId: "bot-1", status: "completed", scheduledFor: now - 60_000, startedAt: now - 60_000, createdAt: now - 60_000, output: "Sent." }];
    const html = click(scheduleCard, "Details").innerHTML;
    expect(html).toMatch(/>Done · Last ran today [^<]* ✓ Sent\.</);
    expect(html).not.toMatch(/(Pause|Resume)<\/button>/);
  });

  it("undoes through the conversation's undo route with the card's request id", () => {
    click(scheduleCard, "Details", "Undo");
    expect(fixture.api).toHaveBeenCalledWith("/api/threads/thread-1/undo", { method: "POST", body: JSON.stringify({ requestId: "request-1" }) });
  });

  it("opens the owning bot's Activity from the creation receipt", () => {
    click(scheduleCard, "Open routine Morning brief");
    expect(document.querySelector("[data-routine-receipt]")?.textContent).toContain("Routine created");
    expect(document.querySelector("[data-trigger-card]")).toBeNull();
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "toggleSettings", open: true, section: "overview", botId: bot.id });
    expect(fixture.api).not.toHaveBeenCalled();
  });

  it("opens Activity for an updated routine using its id even after another rename", () => {
    fixture.state.routines = [{ ...routine, name: "Current brief" }];
    click(updateCard, "Open routine Current brief");
    expect(document.querySelector('button[aria-label="Open routine Current brief"]')).not.toBeNull();
    expect(document.querySelector("[data-routine-receipt]")?.textContent).toContain("Routine updated");
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "toggleSettings", open: true, section: "overview", botId: bot.id });
    expect(fixture.api).not.toHaveBeenCalled();
  });

  it("keeps the reason a run needs you visible when the receipt is collapsed", () => {
    fixture.state.routineRuns = [{ id: "run-3", routineId: routine.id, botId: bot.id, status: "waiting", scheduledFor: now, createdAt: now }];
    expect(mount(scheduleCard).textContent).toContain("Needs you: It's waiting for your answer.");
  });

  it.each(["advanced", "another conversation"])("keeps the Automations route in %s", (mode) => {
    if (mode === "advanced") setAdvancedMode(true);
    else fixture.state.selectedId = "other-bot";
    click(scheduleCard, `Set up: ${sentence}`);
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "showRoutines", view: "list", routineId: "routine-1" });
  });

  it("says when another app sends something, offers Copy address, and shows no address or secret on the card", () => {
    const html = render(webhookCard);
    expect(html).toContain("Set up: When another app sends something, Scout drafts a follow-up for the lead");
    expect(html).toContain(">Hasn&#x27;t run yet<");
    expect(html).toContain("Copy address</button>");
    expect(html).not.toMatch(/whsec_|wh_abc|webhook/i);
  });

  it("pauses one another app sends to through its own API", async () => {
    fixture.api.mockResolvedValue({ webhook: { ...webhook, enabled: false } });
    click(webhookCard, "Pause");
    await vi.waitFor(() => expect(fixture.dispatch).toHaveBeenCalledWith({ type: "webhookPatched", webhook: { ...webhook, enabled: false } }));
    expect(fixture.api).toHaveBeenCalledWith("/api/webhooks/hook-1", { method: "PATCH", body: JSON.stringify({ enabled: false, verificationPending: false }) });
  });

  it("collapses to one muted line once undone, or when the automation is gone", () => {
    expect(render({ ...scheduleCard, card: { ...scheduleCard.card!, undone: true } })).toContain("Automation removed · undone");
    fixture.state.routines = [];
    const gone = render(scheduleCard);
    expect(gone).toContain("This automation no longer exists");
    expect(gone).not.toContain("Pause</button>");
  });

  it("opens Edit over the whole page, never inside the transcript the card sits in", async () => {
    fixture.state = { ...fixture.state, groups: [], sections: [] };
    click(scheduleCard, "Details", "Edit");
    await vi.waitFor(() => expect(document.querySelector("[role=dialog]")).not.toBeNull(), { timeout: 5_000 });
    expect(document.querySelector("[data-trigger-card] [role=dialog]")).toBeNull();
    expect(document.querySelector("[role=dialog]")!.closest("body > div:not(:has([data-trigger-card]))")).not.toBeNull();
  });

  it("never shows an automation whose bot was deleted", () => {
    fixture.state.bots = [];
    expect(render(scheduleCard)).toContain("This automation no longer exists");
    expect(render(webhookCard)).toContain("This automation no longer exists");
  });
});

describe("the chat card a wait with a follow-up leaves", () => {
  const waiting = card({ tool: "wait_until", requestId: "wait-1", waitRequest: { waitId: "wait-1", label: "the build", followUp: "Deploy it." } });
  const cancelShown = () => [...document.querySelectorAll("button")].some((button) => button.textContent?.trim() === "Cancel");

  it("cancels through the undo route, and says what to do next when that fails", async () => {
    fixture.api.mockRejectedValueOnce(new ApiError("disk full", 500));
    click(waiting, "Cancel");
    expect(fixture.api).toHaveBeenCalledWith("/api/threads/thread-1/undo", { method: "POST", body: JSON.stringify({ requestId: "wait-1" }) });
    await vi.waitFor(() => expect(document.querySelector("[role=alert]")?.textContent).toBe("Couldn't cancel the wait. Try again, or ask Scout to stop it."));
  });

  it("shows no error when the wait had already ended: its card says how it ended", async () => {
    fixture.api.mockRejectedValueOnce(new ApiError("This wait has already ended.", 409));
    click(waiting, "Cancel");
    await vi.waitFor(() => expect(cancelShown()).toBe(true));
    expect(document.querySelector("[role=alert]")).toBeNull();
  });
});
