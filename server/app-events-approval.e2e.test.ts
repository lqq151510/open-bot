import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { launchVerificationServer } from "../scripts/control-omb.ts";
import { startAppEventBrokerFixture } from "./testing/app-event-broker-fixture.ts";

it("limits the isolated server's fetch prelude to the loopback broker", async () => {
  const broker = await startAppEventBrokerFixture();
  try {
    const prelude = fileURLToPath(new URL("./testing/loopback-fetch.mjs", import.meta.url));
    const script = `const a = await fetch(${JSON.stringify(`${broker.url}/v1/connectors/connected`)}, {headers: {authorization: ${JSON.stringify(`Bearer ${broker.token}`)}}}); const b = await fetch("https://example.invalid/"); console.log(JSON.stringify([a.status, b.status]));`;
    const result = await promisify(execFile)(process.execPath, ["--import", prelude, "--input-type=module", "-e", script], { timeout: 10_000 });
    expect(JSON.parse(result.stdout)).toEqual([200, 503]);
  } finally {
    await broker.close();
  }
});

it("applies the authenticated creator's personal rule to a delivered app event at Full access", async () => {
  const broker = await startAppEventBrokerFixture();
  const scratch = mkdtempSync(join(tmpdir(), "app-event-approval-"));
  const marker = join(scratch, "side-effect");
  const command = `printf fixture > ${marker}`;
  const fixture = await launchVerificationServer({ FAKE_CLAUDE_MODE: "permission-rules", FAKE_CLAUDE_RUN_BASH: "1",
    FAKE_CLAUDE_TOOL_CALLS: JSON.stringify([{ name: "Bash", input: { command } }]),
    OMB_COMPOSIO_BROKER_URL: broker.url, OMB_COMPOSIO_BROKER_TOKEN: broker.token }, undefined, undefined, undefined, undefined, undefined, [], undefined, undefined, true);
  const api = async (method: string, path: string, body?: unknown, status = 200) => {
    const response = await fetch(fixture.info.url + path, { method, headers: { origin: fixture.info.url, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10_000) });
    const value = await response.json() as any;
    expect(response.status, `${method} ${path}: ${JSON.stringify(value)}`).toBe(status);
    return value;
  };
  try {
    const rules = await api("POST", "/api/permission-rules/always-ask?scope=personal", { text: `command:${command}` });
    expect(rules.teamRules).toEqual([]);
    const { bot } = await api("POST", "/api/bots", { name: "App event fixture", modelSelection: { instanceId: "claude", model: "claude-sonnet-5" } }, 201);
    await api("PATCH", `/api/bots/${bot.id}`, { approvalMode: "full", applyToAllThreads: true });
    const created = await api("POST", "/api/app-triggers", { botId: bot.id, name: "Mail fixture", prompt: "Process fixture mail.", app: "gmail", event: "GMAIL_NEW_GMAIL_MESSAGE" }, 201);
    expect(created.trigger).toMatchObject({ remote: { state: "active" }, accountId: "fixture-account" });
    expect(created.trigger).not.toHaveProperty("approvalCreator");
    broker.deliver(created.trigger.remote.triggerId, { subject: "Fixture mail" });
    const trigger = async () => (await api("GET", "/api/app-triggers")).triggers.find((row: any) => row.id === created.trigger.id);
    await expect.poll(async () => (await trigger())?.lastRunId, { timeout: 25_000 }).toBeTruthy();
    const runId = (await trigger()).lastRunId;
    const run = async () => (await api("GET", "/api/routines")).runs.find((row: any) => row.id === runId);
    await expect.poll(async () => (await run())?.threadId, { timeout: 25_000 }).toBeTruthy();
    const thread = (await run()).threadId;
    const pending = async () => (await api("GET", `/api/threads/${thread}/messages?limit=100`)).messages.find((row: any) => row.card?.heldCode === "approval.held.alwaysAsk" && !row.card.answered)?.card;
    await expect.poll(async () => (await pending())?.requestId, { timeout: 15_000 }).toBeTruthy();
    expect(existsSync(marker)).toBe(false);
    const card = await pending();
    await api("POST", `/api/threads/${thread}/respond`, { requestId: card.requestId, behavior: "deny" });
    await expect.poll(async () => (await run())?.status, { timeout: 15_000 }).toBe("completed");
    expect(existsSync(marker)).toBe(false);

    broker.deliver(created.trigger.remote.triggerId, { subject: "Second fixture mail" });
    await expect.poll(async () => (await trigger())?.lastRunId, { timeout: 25_000 }).not.toBe(runId);
    const secondRunId = (await trigger()).lastRunId;
    const secondRun = async () => (await api("GET", "/api/routines")).runs.find((row: any) => row.id === secondRunId);
    await expect.poll(async () => (await secondRun())?.threadId, { timeout: 25_000 }).toBeTruthy();
    const secondThread = (await secondRun()).threadId;
    const nextCard = async () => (await api("GET", `/api/threads/${secondThread}/messages?limit=100`)).messages.find((row: any) => row.card?.heldCode === "approval.held.alwaysAsk" && !row.card.answered)?.card;
    await expect.poll(async () => (await nextCard())?.requestId, { timeout: 15_000 }).toBeTruthy();
    expect(existsSync(marker)).toBe(false);
    await api("POST", `/api/threads/${secondThread}/respond`, { requestId: (await nextCard()).requestId, behavior: "allow" });
    await expect.poll(async () => (await secondRun())?.status, { timeout: 15_000 }).toBe("completed");
    expect(existsSync(marker)).toBe(true);
  } finally {
    await fixture.close();
    await broker.close();
    rmSync(scratch, { recursive: true, force: true });
  }
}, 90_000);
