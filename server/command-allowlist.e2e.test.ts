// Real isolated server + native Claude permission broker. No real model calls,
// user profiles, shell commands or live application data are used.
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, openSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { connect, type AddressInfo, type Socket } from "node:net";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { launchVerificationServer, verificationServerEnvironment } from "../scripts/control-omb.ts";
import { waitForExit } from "./testing/cleanup.ts";

it("remembers native command grants, honors always-ask rules, and preserves both across restart", async () => {
  const fixture = await launchVerificationServer({ FAKE_CLAUDE_MODE: "hang" });
  const { url, dataDir, logPath } = fixture.info;
  const sockets: Socket[] = [];
  let restarted: ChildProcess | undefined;
  let reviewer: Server | undefined;
  const api = async (method: string, path: string, body?: unknown, status = 200, token?: string) => {
    const response = await fetch(url + path, { method, headers: {
      origin: url, "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}),
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10_000) });
    const result = await response.json() as any;
    expect(response.status, `${method} ${path}: ${JSON.stringify(result)}`).toBe(status);
    return result;
  };
  const messages = async (thread: string): Promise<any[]> => (await api("GET", `/api/threads/${thread}/messages?limit=100`)).messages;
  const card = async (thread: string, id: string) => (await messages(thread)).find(message => message.card?.requestId === id)?.card;
  const start = async (bot: any, thread = bot.threadId) => {
    const dump = join(dataDir, "fake-claude-dump.json");
    rmSync(dump, { force: true });
    await api("POST", `/api/bots/${bot.id}/messages`, { threadId: thread, text: "Hold this verification task while its native command approvals are exercised." }, 202);
    await expect.poll(() => existsSync(dump), { timeout: 15_000 }).toBe(true);
    return JSON.parse(readFileSync(dump, "utf8")).mcpConfig.mcpServers.ogb.args.at(-1) as string;
  };
  const ask = async (socketPath: string, command: string, input = {}, tool = "Bash") => {
    const socket = connect(socketPath);
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => { socket.once("connect", resolve); socket.once("error", reject); });
    const id = randomUUID();
    let answer: any;
    let buffer = "";
    // Native IPC completion is an I/O event, not a one-second UI poll.
    // Keep the same bounded deadline as the fixture's HTTP requests.
    const reply = new Promise<any>((resolve, reject) => {
      socket.once("error", reject);
      socket.once("close", () => reject(new Error(`Permission socket closed before its reply: ${id}`)));
      socket.setTimeout(10_000, () => socket.destroy(new Error(`Permission reply timed out: ${id}`)));
      socket.on("data", chunk => {
        buffer += chunk;
        if (!buffer.includes("\n")) return;
        answer = JSON.parse(buffer.split("\n")[0]!);
        socket.setTimeout(0);
        resolve(answer);
      });
    });
    // Assertions may inspect the card before awaiting this reply; keep an
    // early transport rejection handled while preserving it for the await.
    void reply.catch(() => {});
    socket.write(JSON.stringify({ t: "ask", id, tool, input: { command, ...input } }) + "\n");
    return { id, answer: () => answer, reply, socket };
  };
  const stop = (bot: any, thread = bot.threadId) => api("POST", `/api/bots/${bot.id}/interrupt`, { threadId: thread });
  try {
    const bot = (await api("POST", "/api/bots", { name: "Command rules fixture", modelSelection: { instanceId: "claude", model: "claude-sonnet-5" } }, 201)).bot;
    // The bot on Ask, so every thread it opens asks and only a saved rule answers.
    await api("PATCH", `/api/bots/${bot.id}`, { approvalMode: "ask" });
    const rulesPath = `/api/bots/${bot.id}/command-allowlist`;
    expect((await api("GET", rulesPath)).rules).toEqual([]);
    const alwaysAskPath = "/api/permission-rules/always-ask";
    expect(await api("GET", alwaysAskPath)).toEqual({
      rules: [], teamRules: [], personalRules: [], canEditPersonal: true, canEditTeam: true, semanticReview: false,
    });
    await api("POST", alwaysAskPath, { text: "tool:" }, 400);
    const askRule = (await api("POST", alwaysAskPath, { text: "tool:Read" })).rules[0];
    const socket = await start(bot);
    const command = "printf 'allowlist fixture'";
    const first = await ask(socket, command);
    await expect.poll(async () => Boolean((await card(bot.threadId, first.id))?.commandAllowlist)).toBe(true);
    const candidate = (await card(bot.threadId, first.id)).commandAllowlist;
    expect(candidate.command).toBe(command);
    expect(candidate.cwd).toBe((await api("GET", rulesPath)).context.cwd);

    const pairing = await api("POST", "/api/auth/pairing", { label: "Member fixture", scopes: ["client"] });
    const paired = await api("POST", "/api/auth/pair", { code: pairing.code });
    await api("GET", alwaysAskPath, undefined, 403, paired.token);
    await api("POST", alwaysAskPath, { text: "tool:Bash" }, 403, paired.token);
    await api("PATCH", alwaysAskPath + "/" + askRule.id, { text: "tool:Bash" }, 403, paired.token);
    await api("DELETE", alwaysAskPath + "/" + askRule.id, undefined, 403, paired.token);
    await api("GET", rulesPath, undefined, 403, paired.token);
    await api("POST", rulesPath, candidate, 403, paired.token);
    await api("POST", `/api/threads/${bot.threadId}/respond`, { requestId: first.id, behavior: "allow", rememberCommand: true }, 403, paired.token);
    expect((await api("GET", rulesPath)).rules).toEqual([]);
    expect((await api("POST", `/api/threads/${bot.threadId}/respond`, { requestId: first.id, behavior: "allow", rememberCommand: true })).outcome).toBe("allowed-once");
    expect(await first.reply).toMatchObject({ id: first.id, behavior: "allow" });
    const saved = (await api("GET", rulesPath)).rules[0];
    expect(saved).toMatchObject(candidate);
    for (const profile of (await api("GET", "/api/bots")).bots) expect(profile).not.toHaveProperty("commandAllowlist");

    const repeated = await ask(socket, command);
    expect(await repeated.reply).toMatchObject({ id: repeated.id, behavior: "allow" });
    expect(await card(bot.threadId, repeated.id)).toBeUndefined();
    await expect.poll(async () => (await api("GET", "/api/decisions")).decisions.some((row: any) => row.requestId === repeated.id && row.source === "command-allowlist")).toBe(true);

    const heldPath = alwaysAskPath + "/" + askRule.id;
    const heldCommand = await api("PATCH", heldPath, { text: "command:" + command });
    expect(heldCommand.rules).toEqual([{ id: askRule.id, text: "command:" + command }]);
    const held = await ask(socket, command);
    await expect.poll(async () => (await card(bot.threadId, held.id))?.held).toBe("An always-ask rule requires your approval.");
    expect(held.answer()).toBeUndefined();
    expect(await card(bot.threadId, held.id)).not.toHaveProperty("commandAllowlist");
    await api("POST", `/api/threads/${bot.threadId}/respond`, { requestId: held.id, behavior: "allow", rememberCommand: true }, 403);
    await api("POST", `/api/threads/${bot.threadId}/respond`, { requestId: held.id, behavior: "allow" });
    expect(await held.reply).toMatchObject({ id: held.id, behavior: "allow" });
    await api("PATCH", heldPath, { text: "Ask before sending an email" });
    const noReviewer = await ask(socket, command);
    await expect.poll(async () => (await card(bot.threadId, noReviewer.id))?.held).toBe("An always-ask rule requires your approval.");
    await api("POST", `/api/threads/${bot.threadId}/respond`, { requestId: noReviewer.id, behavior: "deny" });
    expect(await noReviewer.reply).toMatchObject({ id: noReviewer.id, behavior: "deny" });

    const reviewedStates: unknown[] = [];
    let confidence = 1;
    const stub = createServer(async (request, response) => {
      if (request.method !== "POST" || request.url !== "/v1/systemone") return void response.writeHead(404).end();
      let raw = "";
      for await (const chunk of request) raw += chunk;
      const body = JSON.parse(raw);
      reviewedStates.push(body.state);
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
        answers: { answer: { type: "noul", noul: confidence } },
      }));
    });
    reviewer = stub;
    await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", resolve));
    await api("PUT", "/api/config", { decider: { baseUrl: `http://127.0.0.1:${(stub.address() as AddressInfo).port}` } });
    await api("PUT", "/api/config", { decider: { key: "tsk_verification_fixture_only" } });
    expect((await api("GET", alwaysAskPath)).semanticReview).toBe(true);
    const clear = await ask(socket, command);
    expect(await clear.reply).toMatchObject({ id: clear.id, behavior: "allow" });
    expect(reviewedStates.at(-1)).toEqual({ tool: "Bash", rules: ["Ask before sending an email"] });
    expect(await card(bot.threadId, clear.id)).toBeUndefined();
    confidence = 0.55;
    const uncertain = await ask(socket, command);
    await expect.poll(async () => (await card(bot.threadId, uncertain.id))?.heldCode).toBe("approval.held.alwaysAsk");
    await api("POST", `/api/threads/${bot.threadId}/respond`, { requestId: uncertain.id, behavior: "deny" });
    expect(await uncertain.reply).toMatchObject({ id: uncertain.id, behavior: "deny" });
    expect((await api("DELETE", heldPath)).rules).toEqual([]);
    expect(await api("POST", alwaysAskPath, { text: "tool:Read" }, 409)).toMatchObject({ code: "always_ask_busy" });

    for (const [text, input, tool] of [
      [command + " && pwd", {}, "Bash"],
      [command, { dangerouslyDisableSandbox: true }, "Bash"],
      [command, {}, "mcp__other__shell"],
    ] as const) {
      const different = await ask(socket, text, input, tool);
      await expect.poll(async () => Boolean(await card(bot.threadId, different.id))).toBe(true);
      expect(different.answer()).toBeUndefined();
      await api("POST", `/api/threads/${bot.threadId}/respond`, { requestId: different.id, behavior: "deny" });
      expect(await different.reply).toMatchObject({ id: different.id, behavior: "deny" });
    }
    await api("DELETE", rulesPath + "/" + saved.id);
    const revoked = await ask(socket, command);
    await expect.poll(async () => Boolean(await card(bot.threadId, revoked.id))).toBe(true);
    await api("POST", `/api/bots/${bot.id}/respond`, { threadId: bot.threadId, requestId: revoked.id, behavior: "allow", rememberCommand: true });
    expect(await revoked.reply).toMatchObject({ id: revoked.id, behavior: "allow" });
    expect((await api("GET", rulesPath)).rules).toHaveLength(1);
    await stop(bot);
    await api("POST", `/api/threads/${bot.threadId}/respond`, { requestId: revoked.id, behavior: "allow", rememberCommand: true }, 403);

    const sibling = (await api("POST", `/api/bots/${bot.id}/tasks`, { title: "Different folder" }, 201)).task;
    const otherSocket = await start(bot, sibling.threadId);
    const other = await ask(otherSocket, command);
    await expect.poll(async () => Boolean(await card(sibling.threadId, other.id))).toBe(true);
    expect((await card(sibling.threadId, other.id)).commandAllowlist.cwd).not.toBe(candidate.cwd);
    await stop(bot, sibling.threadId);
    expect(await other.reply).toMatchObject({ id: other.id, behavior: "deny" });

    await api("PATCH", `/api/bots/${bot.id}`, { cwd: candidate.cwd });
    const shared = (await api("POST", `/api/bots/${bot.id}/tasks`, { title: "Same project folder" }, 201)).task;
    const sharedSocket = await start(bot, shared.threadId);
    const sharedRequest = await ask(sharedSocket, command);
    // Receiving can lag a correct broker reply on a busy runner. Preserve
    // that gap beyond expect.poll's default 1s without changing the grant.
    sharedRequest.socket.pause();
    await delay(1_100);
    expect(sharedRequest.answer()).toBeUndefined();
    sharedRequest.socket.resume();
    expect(await sharedRequest.reply).toMatchObject({ id: sharedRequest.id, behavior: "allow" });
    expect(await card(shared.threadId, sharedRequest.id)).toBeUndefined();
    await stop(bot, shared.threadId);

    await expect.poll(async () => (await api("POST", alwaysAskPath, { text: "tool:Read" })).rules.length).toBe(1);
    const retained = (await api("GET", alwaysAskPath)).rules;
    await waitForExit(fixture.child, { signal: "SIGTERM" });
    const log = openSync(logPath, "a", 0o600);
    restarted = spawn(process.execPath, ["--experimental-strip-types", fileURLToPath(new URL("./index.ts", import.meta.url))], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: verificationServerEnvironment({ FAKE_CLAUDE_MODE: "hang" }, dataDir, Number(new URL(url).port)),
      stdio: ["ignore", log, log],
    });
    closeSync(log);
    await expect.poll(async () => {
      try { return (await fetch(url + "/api/health", { signal: AbortSignal.timeout(1000) })).ok; } catch { return false; }
    }, { timeout: 20_000 }).toBe(true);
    expect((await api("GET", rulesPath)).rules).toHaveLength(1);
    expect((await api("GET", alwaysAskPath)).rules).toEqual(retained);
    await api("PATCH", `/api/bots/${bot.id}`, { approvalMode: "full", applyToAllThreads: true });
    const restartedSocket = await start(bot);
    const { argv } = JSON.parse(readFileSync(join(dataDir, "fake-claude-dump.json"), "utf8")) as { argv: string[] };
    expect(argv[argv.indexOf("--permission-mode") + 1]).toBe("default");
    const restored = await ask(restartedSocket, command);
    expect(await restored.reply).toMatchObject({ id: restored.id, behavior: "allow" });
    expect(await card(bot.threadId, restored.id)).toBeUndefined();
    await api("PATCH", alwaysAskPath + "/" + retained[0].id, { text: "tool:Bash" });
    const fullHeld = await ask(restartedSocket, command);
    await expect.poll(async () => (await card(bot.threadId, fullHeld.id))?.heldCode).toBe("approval.held.alwaysAsk");
    await api("POST", `/api/threads/${bot.threadId}/respond`, { requestId: fullHeld.id, behavior: "deny" });
    expect(await fullHeld.reply).toMatchObject({ id: fullHeld.id, behavior: "deny" });
    await stop(bot);
    await api("DELETE", alwaysAskPath + "/" + retained[0].id);
    const personal = await api("POST", alwaysAskPath + "?scope=personal", { text: "command:" + command });
    expect(personal.teamRules).toEqual([]);
    expect(personal.personalRules).toHaveLength(1);
    const personalSocket = await start(bot);
    const personalHeld = await ask(personalSocket, command);
    await expect.poll(async () => (await card(bot.threadId, personalHeld.id))?.heldCode).toBe("approval.held.alwaysAsk");
    expect(personalHeld.answer()).toBeUndefined();
    await api("POST", `/api/threads/${bot.threadId}/respond`, { requestId: personalHeld.id, behavior: "deny" });
    expect(await personalHeld.reply).toMatchObject({ id: personalHeld.id, behavior: "deny" });
    await stop(bot);

    const dump = join(dataDir, "fake-claude-dump.json");
    const nextBroker = async () => {
      await expect.poll(() => existsSync(dump), { timeout: 15_000 }).toBe(true);
      return JSON.parse(readFileSync(dump, "utf8")).mcpConfig.mcpServers.ogb.args.at(-1) as string;
    };
    const assertPersonalHold = async (threadId: string) => {
      const request = await ask(await nextBroker(), command);
      await expect.poll(async () => (await card(threadId, request.id))?.heldCode).toBe("approval.held.alwaysAsk");
      expect(request.answer()).toBeUndefined();
      await api("POST", `/api/threads/${threadId}/respond`, { requestId: request.id, behavior: "deny" });
      expect(await request.reply).toMatchObject({ id: request.id, behavior: "deny" });
    };

    const helper = (await api("POST", "/api/bots", { name: "Room helper fixture" }, 201)).bot;
    const { group } = await api("POST", "/api/groups", { name: "Rules room fixture", memberIds: [bot.id, helper.id],
      setup: { bulletin: "", defaultResponder: { kind: "member", botId: bot.id } },
    }, 201);
    rmSync(dump, { force: true });
    await api("POST", `/api/groups/${group.id}/messages`, { threadId: group.threadId, text: "Run the room approval fixture." }, 202);
    await assertPersonalHold(group.threadId);
    await api("POST", `/api/groups/${group.id}/interrupt`, { threadId: group.threadId });

    const { webhook } = await api("POST", "/api/webhooks", { name: "Personal rule webhook", botId: bot.id, prompt: "Run the webhook fixture." }, 201);
    expect(webhook).not.toHaveProperty("approvalCreator");
    rmSync(dump, { force: true });
    const { runId } = await api("POST", `/api/webhooks/${webhook.id}/test`, {}, 202);
    const runFor = async () => (await api("GET", "/api/routines")).runs.find((run: { id: string }) => run.id === runId);
    await expect.poll(async () => (await runFor())?.threadId, { timeout: 15_000 }).toBeTruthy();
    await assertPersonalHold((await runFor()).threadId);
    await api("POST", `/api/routine-runs/${runId}/cancel`);

    const editorInvite = await api("POST", "/api/auth/pairing", { label: "Editor fixture", scopes: ["client", "admin"] });
    const editor = await api("POST", "/api/auth/pair", { code: editorInvite.code });
    const editorRule = await api("POST", alwaysAskPath + "?scope=personal", { text: "command:" + command }, 200, editor.token);
    expect(editorRule.personalRules[0].id).not.toBe(personal.personalRules[0].id);
    const source = (await messages(bot.threadId)).find((message) => message.role === "user" && message.kind === "text");
    rmSync(dump, { force: true });
    await api("POST", `/api/bots/${bot.id}/messages/${source.id}/edit`, { threadId: bot.threadId, text: "Exercise the editor's approval rules." }, 202, editor.token);
    await assertPersonalHold(bot.threadId);
    await stop(bot);

    rmSync(dump, { force: true });
    await api("POST", `/api/bots/${bot.id}/messages`, { threadId: bot.threadId, mode: "goal", text: "Exercise the goal starter's approval rules." }, 202, editor.token);
    await assertPersonalHold(bot.threadId);
    await stop(bot);
    console.info(`Command allowlist real-server verification passed; isolated log: ${logPath}`);
  } finally {
    for (const socket of sockets) socket.destroy();
    await waitForExit(restarted, { signal: "SIGTERM" });
    await fixture.close();
    if (reviewer) await new Promise<void>((resolve) => reviewer!.close(() => resolve()));
  }
}, 90_000);
