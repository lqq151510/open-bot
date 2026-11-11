// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import type { Bot } from "@/state/store";

const fixture = vi.hoisted(() => ({
  owner: true as boolean | null,
  bots: [] as Bot[],
  dispatch: vi.fn(),
  api: vi.fn(async () => ({
    rules: [] as { id: string; command: string; cwd: string; providerInstanceId: string }[],
    supported: true,
    context: { providerInstanceId: "claude", cwd: "/work/fixture" },
  })),
}));

vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => fixture.owner }));
vi.mock("./Avatar", () => ({ BotAvatar: () => null }));
vi.mock("@/state/store", () => ({
  useStore: () => ({ state: { bots: fixture.bots, instances: [] }, dispatch: fixture.dispatch }),
  api: (path: string, init?: RequestInit) => fixture.api(path, init),
}));

const { SimplePermissionsPage } = await import("./SettingsSimplePages");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const bot = (id: string, name: string, extra: Partial<Bot> = {}): Bot => ({
  id, name, threadId: `${id}-thread`, hidden: false, approvalMode: "ask", description: "", title: "",
  color: "purple", notifications: false, unread: false, messages: [],
  modelSelection: { instanceId: "claude", model: "claude" },
  ...extra,
}) as Bot;

let host: HTMLDivElement;
let root: Root;

const show = async () => {
  await act(async () => { root.render(createElement(SimplePermissionsPage)); });
};

beforeEach(() => {
  setLocale("en");
  fixture.owner = true;
  fixture.bots = [bot("atlas", "Atlas")];
  fixture.dispatch.mockReset();
  fixture.api.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("simple permissions", () => {
  it("opens the command allowlist for the only bot, including its empty list", async () => {
    await show();
    expect(host.querySelector("[data-permission-always-ask] button")).toBeNull();
    expect(host.textContent).toContain("There is no separate always-ask list.");
    const add = host.querySelector<HTMLButtonElement>("[data-permission-allow-rule]");
    expect(add?.textContent).toBe("Add rule");
    await act(async () => { add!.click(); });
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("No commands saved yet.");
    });
    expect(document.body.textContent).toContain("Saved commands for Atlas");
    expect(fixture.api).toHaveBeenCalledWith("/api/bots/atlas/command-allowlist", expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("asks which bot to open when more than one can save commands", async () => {
    fixture.bots = [bot("atlas", "Atlas"), bot("scout", "Scout")];
    await show();
    await act(async () => { host.querySelector<HTMLButtonElement>("[data-permission-allow-rule]")!.click(); });
    expect(document.body.textContent).not.toContain("No commands saved yet.");
    expect(host.querySelector("[data-permission-allow-bot='scout']")?.textContent).toBe("Scout");
    await act(async () => { host.querySelector<HTMLButtonElement>("[data-permission-allow-bot='scout']")!.click(); });
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("Saved commands for Scout");
    });
    expect(fixture.api).toHaveBeenCalledWith("/api/bots/scout/command-allowlist", expect.any(Object));
  });

  it("has no add button when there is no bot, and none for someone who cannot save rules", async () => {
    fixture.bots = [];
    await show();
    expect(host.querySelector("[data-permission-allow-rule]")).toBeNull();
    expect(host.textContent).toContain("No bots yet.");
    fixture.owner = false;
    fixture.bots = [bot("atlas", "Atlas")];
    await show();
    expect(host.querySelector("[data-permission-allow-rule]")).toBeNull();
    expect(host.querySelector("[data-permission-bot='atlas']")).not.toBeNull();
  });
});
