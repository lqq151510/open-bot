// Native Codex, a loopback model and temporary state; never reads a real login.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = mkdtempSync(join(tmpdir(), "omb-real-rule-"));
for (const key of Object.keys(process.env)) {
  if (!["PATH", "TMPDIR", "LANG", "LC_ALL", "USER", "PROBE_CODEX"].includes(key)) delete process.env[key];
}
process.env.OMB_DATA_DIR = join(root, "omb");
process.env.NO_PROXY = "127.0.0.1,localhost";
process.env.no_proxy = "127.0.0.1,localhost";
process.env.HTTP_PROXY = process.env.HTTPS_PROXY = "http://127.0.0.1:9";
process.env.http_proxy = process.env.https_proxy = "http://127.0.0.1:9";
mkdirSync(join(root, "omb", "native"), { recursive: true });
const { CodexDriver } = await import("../server/drivers/codex.ts");
const { recordEvents } = await import("../server/testing/events.ts");
let input = "";
let calls = 0;
const server = createServer(async (req, res) => {
  if (req.method !== "POST") { res.end("{}"); return; }
  for await (const _chunk of req) { /* consume the request */ }
  calls++;
  const item = calls === 1
    ? { id: "ctc_1", type: "custom_tool_call", status: "completed", call_id: "call_1", name: "exec", input }
    : { id: "msg_2", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Done.", annotations: [] }] };
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const event of [
    { type: "response.created", response: { id: `r${calls}`, status: "in_progress", output: [] } },
    { type: "response.output_item.added", output_index: 0, item: item.type === "message" ? { ...item, content: [] } : item },
    { type: "response.output_item.done", output_index: 0, item },
    { type: "response.completed", response: { id: `r${calls}`, status: "completed", output: [item] } },
  ]) res.write(`data: ${JSON.stringify(event)}\n\n`);
  res.end();
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let instance;
try {
  for (const mode of ["patch", "command"]) {
    calls = 0;
    const home = join(root, `${mode}-home`), cwd = join(root, `${mode}-cwd`);
    mkdirSync(home); mkdirSync(cwd); mkdirSync(join(home, "rules"));
    writeFileSync(join(home, "config.toml"), `model="gpt-5.6-luna"\nmodel_provider="fixture"\n[model_providers.fixture]\nname="Fixture"\nbase_url="http://127.0.0.1:${server.address().port}/v1"\nwire_api="responses"\nrequires_openai_auth=false\n`);
    writeFileSync(join(home, "rules", "default.rules"), 'prefix_rule(pattern=["touch"], decision="allow")\n');
    const sentinel = join(cwd, "sentinel");
    const patch = "*** Begin Patch\n*** Add File: sentinel\n+fixture\n*** End Patch";
    input = mode === "patch"
      ? `text(await tools.apply_patch(${JSON.stringify(patch)}));`
      : `text(await tools.exec_command({cmd:${JSON.stringify(`touch ${sentinel}`)},workdir:${JSON.stringify(cwd)}}));`;
    instance = await CodexDriver.create({ instanceId: "rule-probe", displayName: "fixture", enabled: true,
      config: { cli: process.env.PROBE_CODEX ?? "codex", fullAuto: true },
      environment: { HOME: home, USERPROFILE: home, CODEX_HOME: home, NO_PROXY: "127.0.0.1,localhost", no_proxy: "127.0.0.1,localhost" } });
    const recorder = recordEvents(instance.adapter);
    const { turnId } = await instance.adapter.sendTurn({ threadId: mode, text: "Fixture only.", cwd,
      model: "fixture::gpt-5.6-luna", approvalMode: "full", approvalRulesActive: () => true });
    const seen = await Promise.race([
      recorder.until((event) => event.turnId === turnId && event.type === "request.opened", 20_000).then((event) => ({ kind: "approval", event })),
      recorder.until((event) => event.turnId === turnId && event.type === "turn.completed", 20_000).then((event) => ({ kind: "completed", event })),
    ]);
    if (seen.kind === "approval") {
      await instance.adapter.respondToRequest(mode, seen.event.requestId, { behavior: "deny" });
      await recorder.until((event) => event.turnId === turnId && event.type === "turn.completed", 20_000);
    }
    assert.equal(seen.kind, mode === "patch" ? "approval" : "completed");
    assert.equal(existsSync(sentinel), seen.kind === "completed");
    console.log(JSON.stringify({ mode, result: seen.kind, tool: seen.event.tool, sideEffect: existsSync(sentinel) }));
    await instance.dispose(); instance = undefined;
  }
} finally {
  await instance?.dispose();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  rmSync(root, { recursive: true, force: true });
}
