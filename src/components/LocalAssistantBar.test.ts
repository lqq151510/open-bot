// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import type { AppState, Bot } from "@/state/store";

const fixture = vi.hoisted(() => ({
  state: {} as AppState,
  dispatch: vi.fn(),
  api: vi.fn(),
}));

vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return {
    ...original,
    useStore: () => ({ state: fixture.state, dispatch: fixture.dispatch }),
    api: fixture.api,
  };
});

const {
  LocalAssistantBar,
  selectLocalAssistantTarget,
  selectLocalAssistantTargets,
} = await import("./LocalAssistantBar");
const { initialState } = await import("@/state/store");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeBot(id: string, overrides: Partial<Bot> = {}): Bot {
  return {
    id,
    threadId: `${id}-main`,
    name: id,
    title: "",
    description: "",
    notifications: true,
    color: "chrome",
    unread: false,
    modelSelection: { instanceId: "claude", model: "sonnet" },
    messages: [],
    ...overrides,
  };
}

describe("selectLocalAssistantTarget", () => {
  it("returns null when no bot is busy on local/vm or holding computerControl", () => {
    const state = {
      ...initialState,
      selectedId: "a",
      bots: [
        makeBot("a", { busy: true, computer: "cloud" }),
        makeBot("b", { busy: true, computer: "browser" }),
        makeBot("c", { busy: false, computer: "local" }),
        makeBot("hidden", { hidden: true, busy: true, computer: "local" }),
      ],
      computerControl: {},
    };
    expect(selectLocalAssistantTarget(state)).toBeNull();
    expect(selectLocalAssistantTargets(state)).toEqual([]);
  });

  it("detects a bot working on local via bot.computer or current task surface", () => {
    const direct = selectLocalAssistantTarget({
      ...initialState,
      selectedId: "local-bot",
      bots: [makeBot("local-bot", { busy: true, computer: "local" })],
      computerControl: {},
    });
    expect(direct).toMatchObject({ bot: { id: "local-bot" }, place: "local", mode: "local" });

    const autoBot = selectLocalAssistantTarget({
      ...initialState,
      selectedId: "auto-bot",
      bots: [
        makeBot("auto-bot", {
          busy: true,
          tasks: [
            {
              threadId: "auto-bot-main",
              title: "Main",
              createdAt: 1,
              busy: true,
              surface: "local",
            },
          ],
        }),
      ],
      computerControl: {},
    });
    expect(autoBot).toMatchObject({ bot: { id: "auto-bot" }, place: "local", mode: "local" });
  });

  it("detects background busy task surface and vm / computerControl states", () => {
    const bgVm = selectLocalAssistantTarget({
      ...initialState,
      selectedId: "vm-bot",
      bots: [
        makeBot("vm-bot", {
          busy: true,
          tasks: [
            { threadId: "vm-bot-main", title: "Main", createdAt: 1 },
            { threadId: "vm-bot-bg", title: "BG", createdAt: 2, busy: true, surface: "vm" },
          ],
        }),
      ],
      computerControl: {},
    });
    expect(bgVm).toMatchObject({ bot: { id: "vm-bot" }, place: "vm", mode: "control" });

    const heldIdle = selectLocalAssistantTarget({
      ...initialState,
      selectedId: "other",
      bots: [
        makeBot("other", { busy: true, computer: "local" }),
        makeBot("cloud-help", { busy: false, computer: "cloud" }),
      ],
      computerControl: {
        "cloud-help": { held: false, helpReason: "Sign in to GitHub" },
      },
    });
    expect(heldIdle).toMatchObject({
      bot: { id: "cloud-help" },
      mode: "control",
      helpReason: "Sign in to GitHub",
    });
  });
});

describe("LocalAssistantBar component", () => {
  let host: HTMLDivElement;
  let root: Root;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    setLocale("en");
    fixture.dispatch.mockReset();
    fixture.api.mockReset();
    fixture.state = { ...initialState };
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await act(async () => root.unmount());
    host.remove();
  });

  it("pauses local computer actions and opens the Screen panel when working locally", async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    globalThis.fetch = fetchSpy as typeof fetch;
    fixture.state = {
      ...initialState,
      selectedId: "alpha",
      bots: [makeBot("alpha", { name: "Scout", busy: true, computer: "local" })],
      computerControl: {},
    };

    await act(async () => {
      root.render(createElement(LocalAssistantBar));
    });

    expect(host.textContent).toContain("Scout is working on this computer");
    const pauseButton = host.querySelector<HTMLButtonElement>('[data-local-bar-action="pause"]')!;
    const viewButton = host.querySelector<HTMLButtonElement>('[data-local-bar-action="view"]')!;
    expect(pauseButton.textContent).toContain("Pause computer actions");
    expect(viewButton.textContent).toContain("View");

    await act(async () => {
      pauseButton.click();
    });

    expect(fetchSpy).toHaveBeenCalledWith("/api/local-computer/interrupt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });

    await act(async () => {
      viewButton.click();
    });

    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "select", id: "alpha" });
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "toggleComputer", open: true, botId: "alpha" });
  });

  it("supports Take control / Hand back and Watch screen for vm or leased desktops", async () => {
    fixture.api.mockResolvedValueOnce({ held: true, heldByOther: false, helpReason: null, help: null });
    fixture.state = {
      ...initialState,
      selectedId: "vm-1",
      bots: [makeBot("vm-1", { name: "Builder", busy: true, computer: "vm" })],
      computerControl: { "vm-1": { held: false, helpReason: null } },
    };

    await act(async () => {
      root.render(createElement(LocalAssistantBar));
    });

    expect(host.textContent).toContain("Builder is working on local cloud computer");
    const takeButton = host.querySelector<HTMLButtonElement>('[data-local-bar-action="take"]')!;
    expect(takeButton.textContent).toContain("Take control");

    await act(async () => {
      takeButton.click();
    });

    expect(fixture.api).toHaveBeenCalledWith("/api/bots/vm-1/computer/control", {
      method: "POST",
      body: JSON.stringify({ action: "take" }),
    });
    expect(fixture.dispatch).toHaveBeenCalledWith({
      type: "computerControl",
      botId: "vm-1",
      held: true,
      heldByOther: false,
      helpReason: null,
      help: null,
    });

    fixture.api.mockResolvedValueOnce({ held: false, heldByOther: false, helpReason: null, help: null });
    fixture.state = {
      ...fixture.state,
      computerControl: { "vm-1": { held: true, helpReason: null } },
    };

    await act(async () => {
      root.render(createElement(LocalAssistantBar));
    });

    expect(host.textContent).toContain("You have control of Builder's screen");
    const releaseButton = host.querySelector<HTMLButtonElement>('[data-local-bar-action="release"]')!;
    expect(releaseButton.textContent).toContain("Hand back");

    await act(async () => {
      releaseButton.click();
    });

    expect(fixture.api).toHaveBeenCalledWith("/api/bots/vm-1/computer/control", {
      method: "POST",
      body: JSON.stringify({ action: "release" }),
    });

    const watchButton = host.querySelector<HTMLButtonElement>('[data-local-bar-action="watch"]')!;
    await act(async () => {
      watchButton.click();
    });
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "toggleComputer", open: true, botId: "vm-1" });
  });
});
