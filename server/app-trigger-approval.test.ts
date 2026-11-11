import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";

import type { AppTriggerBroker } from "./app-trigger-broker.ts";
import { AppTriggerManager, type AppTriggerManagerOptions } from "./app-triggers.ts";
import { personKey } from "./person-key.ts";

it("keeps an app event's approval creator private and attached to its local trigger after restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "openbot-app-trigger-approval-"));
  const creator = personKey({ id: "verified-creator" });
  const other = personKey({ id: "untrusted-body-creator" });
  const enqueue = vi.fn<AppTriggerManagerOptions["runs"]["enqueue"]>(() => ({ id: "isolated-run" }));
  const neverCalled = async () => { throw new Error("Unexpected broker call"); };
  const broker: AppTriggerBroker = {
    triggerTypes: neverCalled, inventory: neverCalled, testEvent: neverCalled, remove: neverCalled,
    setEnabled: async () => {}, create: async () => ({ triggerId: "broker-trigger" }),
    triggerType: async (slug) => ({ slug, toolkit: "gmail", name: "New mail", description: "", config: {}, payload: {} }),
    poll: async () => ({ cursor: 1, events: [{ seq: 1, id: "event-1", kind: "message", triggerId: "broker-trigger", receivedAt: Date.now(), event: { data: { subject: "Fixture" } } }] }),
  };
  const options: AppTriggerManagerOptions = {
    file: join(dir, "app-triggers.json"), broker, service: () => ({ available: true }),
    connectedApps: async () => ({ gmail: { connected: true, accounts: [{ id: "isolated-account", status: "active" }] } }),
    botState: () => "ready",
    runs: { enqueue, merge: () => null, receipt: () => null, pending: () => 0, cancelQueued: () => {} },
  };
  try {
    const manager = new AppTriggerManager(options);
    const input = { botId: "isolated-bot", name: "Report mail", prompt: "Draft a report", app: "gmail", event: "GMAIL_NEW_GMAIL_MESSAGE", approvalCreator: other };
    const trigger = await manager.create(input, creator);
    expect(trigger).not.toHaveProperty("approvalCreator");
    expect(await manager.update(trigger.id, { name: "New fixture name" })).not.toHaveProperty("approvalCreator");
    const restored = new AppTriggerManager(options);
    expect(restored.approvalCreator(trigger.id)).toBe(creator);
    expect(restored.get(trigger.id)).not.toHaveProperty("approvalCreator");
    await restored.pollOnce(undefined, 0);
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ webhookId: trigger.id, deliveryId: "event-1", eventSource: "app" }));
    const unattributed = await restored.create({ ...input, prompt: "Draft a summary" });
    expect(restored.approvalCreator(unattributed.id)).toBeUndefined();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
