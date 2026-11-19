// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { Message } from "@/state/store";
import { YOUR_COMPUTER_TOOL } from "../../shared/your-computer";
import { PendingApprovalPanel, pendingApprovals } from "./PendingApproval";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const macName = "工作室 Mac 🧪";

afterEach(() => vi.unstubAllGlobals());

async function checkCard(input: { ownPage: boolean; copy?: boolean; computer?: boolean; showLocalComputerName?: boolean; remote?: boolean; read: () => Promise<string | null> }, verify: (host: HTMLElement) => void) {
  const { ownPage, copy, computer = true, showLocalComputerName = true, remote = false, read } = input;
  vi.stubGlobal("ogb", { platform: "darwin", app: { ownPage }, remoteClient: { active: remote }, deviceAccess: { computerName: read } });
  const message: Message = {
    id: "m1", at: 1, role: "bot", kind: "options",
    card: {
      title: "Approval needed", subtitle: "", requestId: "r1", requestType: "permission", options: ["Allow once", "Deny"],
      ...(computer ? { tool: YOUR_COMPUTER_TOOL, yourComputer: {} } : { tool: "Bash" }),
    },
    ...(copy ? { inbox: { kind: "ask", from: { name: "Other bot", botId: "bot" } } } : {}),
  };
  const [pending] = pendingApprovals([message]);
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  try {
    await act(async () => { root.render(createElement(PendingApprovalPanel, { pending: pending!, count: 1, index: 0, showLocalComputerName })); });
    verify(host);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
}

it("shows the Mac's name alongside the one-time computer question", async () => {
  const read = vi.fn(async () => macName);
  await checkCard({ ownPage: true, read }, (host) => {
    expect(host.textContent).toContain("I need to use your computer's screen for this. Allow once?");
    expect(host.querySelector("[data-ask-card='approval'] p")?.textContent).toBe(macName);
  });
  expect(read).toHaveBeenCalledOnce();
});

it.each([
  { ownPage: false },
  { ownPage: true, copy: true },
  { ownPage: true, computer: false },
  { ownPage: true, showLocalComputerName: false },
  { ownPage: true, remote: true },
])("does not read the local name for a different approval scope (%j)", async (scope) => {
  const read = vi.fn(async () => macName);
  await checkCard({ ...scope, read }, (host) => expect(host.textContent).not.toContain(macName));
  expect(read).not.toHaveBeenCalled();
});

it("keeps the computer question usable when the name cannot be read", async () => {
  const read = vi.fn(async () => { throw new Error("bridge unavailable"); });
  await checkCard({ ownPage: true, read }, (host) => {
    expect(host.textContent).toContain("Allow once?");
    expect(host.querySelector("[data-ask-card='approval'] p")).toBeNull();
  });
  expect(read).toHaveBeenCalledOnce();
});
