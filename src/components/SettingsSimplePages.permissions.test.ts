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
  api: vi.fn<(path: string, init?: RequestInit) => Promise<unknown>>(async () => ({
    rules: [] as { id: string; command: string; cwd: string; providerInstanceId: string }[],
    supported: true,
    context: { providerInstanceId: "claude", cwd: "/work/fixture" },
  })),
}));

vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => fixture.owner }));
vi.mock("./Avatar", () => ({ BotAvatar: () => null }));
vi.mock("@/state/store", () => ({
  useStore: () => ({ state: { bots: fixture.bots, instances: [] }, dispatch: fixture.dispatch }),
  api: fixture.api,
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
    expect(host.querySelector("[data-permission-ask-rule]")).not.toBeNull();
    expect(host.textContent).toContain("No rules yet.");
    const add = host.querySelector<HTMLButtonElement>("[data-permission-allow-rule]");
    expect(add?.textContent).toBe("Add rule");
    await act(async () => { add!.click(); });
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("No commands saved yet.");
    });
    expect(document.body.textContent).toContain("Saved commands for Atlas");
    expect(fixture.api).toHaveBeenCalledWith("/api/bots/atlas/command-allowlist", expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("lets a member edit personal rules and see inherited team rules", async () => {
    const path = "/api/permission-rules/always-ask";
    const rule = { id: "fixture-rule", text: "tool:Bash" };
    const changed = { ...rule, text: "command:git push" };
    const teamRules = [{ id: "inherited", text: "tool:Write" }];
    const data = { rules: teamRules, teamRules, canEditPersonal: true, canEditTeam: false, semanticReview: false };
    fixture.api.mockResolvedValueOnce({ ...data, personalRules: [] })
      .mockResolvedValueOnce({ ...data, personalRules: [rule] })
      .mockResolvedValueOnce({ ...data, personalRules: [changed] })
      .mockResolvedValueOnce({ ...data, personalRules: [] });
    fixture.owner = false;
    fixture.bots = [];
    await show();

    const fillRule = async (value: string) => {
      const input = host.querySelector("textarea")!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => { input.form!.requestSubmit(); });
    };

    const team = host.querySelector("[data-permission-ask-scope='team']")!;
    expect(team.textContent).toContain("tool:Write");
    expect(team.querySelector("button")).toBeNull();
    await act(async () => { host.querySelector<HTMLButtonElement>("[data-permission-ask-rule='personal']")!.click(); });
    await fillRule(rule.text);
    expect(host.textContent).toContain(rule.text);
    expect(fixture.api).toHaveBeenCalledWith(path + "?scope=personal", expect.objectContaining({ method: "POST", body: JSON.stringify({ text: rule.text }) }));

    await act(async () => { host.querySelector<HTMLButtonElement>("[aria-label='Edit always-ask rule 1']")!.click(); });
    await fillRule(changed.text);
    expect(host.textContent).toContain(changed.text);
    expect(fixture.api).toHaveBeenCalledWith(path + "/" + rule.id + "?scope=personal", expect.objectContaining({ method: "PATCH" }));

    await act(async () => { host.querySelector<HTMLButtonElement>("[aria-label='Delete always-ask rule 1']")!.click(); });
    expect(host.querySelector("[data-permission-ask-scope='personal']")?.textContent).toContain("No rules yet.");
    expect(team.textContent).toContain("tool:Write");
    expect(fixture.api).toHaveBeenCalledWith(path + "/" + rule.id + "?scope=personal", { method: "DELETE" });
  });

  it("uses team scope when an administrator removes a team rule", async () => {
    const teamRules = [{ id: "team-rule", text: "tool:Write" }];
    const personalRules = [{ id: "personal-rule", text: "tool:Bash" }];
    const data = { rules: teamRules, teamRules, personalRules, canEditPersonal: true, canEditTeam: true, semanticReview: false };
    fixture.api.mockResolvedValueOnce(data).mockResolvedValueOnce({ ...data, rules: [], teamRules: [] });
    await show();
    const team = host.querySelector("[data-permission-ask-scope='team']")!;
    await act(async () => { team.querySelector<HTMLButtonElement>("[aria-label='Delete always-ask rule 1']")!.click(); });
    expect(fixture.api).toHaveBeenCalledWith("/api/permission-rules/always-ask/team-rule?scope=team", { method: "DELETE" });
    expect(team.textContent).toContain("No rules yet.");
    expect(host.querySelector("[data-permission-ask-scope='personal']")?.textContent).toContain("tool:Bash");
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
    expect(host.querySelector("[data-permission-ask-rule]")).toBeNull();
    expect(host.querySelector("[data-permission-bot='atlas']")).not.toBeNull();
  });
});
