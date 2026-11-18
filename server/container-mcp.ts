// A stdio bridge into Cua Driver's MCP server in the Local VM. It defines no tools; the shared bridge only answers ping,
// makes tool schemas provider-safe and keeps error results text-only.
import { cuaExecArgs } from "./container-computer.ts";
import { RUNTIMES, spawnRuntimeCommand, type Runtime } from "./container-runtime-wsl.ts";
import { runMcpBridge } from "./mcp-bridge.ts";

function isRuntime(value: string | undefined): value is Runtime {
  return value !== undefined && (RUNTIMES as readonly string[]).includes(value);
}

const [runtime, container, socket] = process.argv.slice(2);
if (!isRuntime(runtime)) {
  process.stderr.write("invalid Local VM runtime\n");
  process.exit(2);
}
if (!container || !/^[a-zA-Z0-9_.-]+$/.test(container) || !socket?.startsWith("/run/user/1000/")) {
  process.stderr.write("invalid Local VM connection\n");
  process.exit(2);
}

// The who-is-driving pair rides in env, not argv, which `ps` shows to everyone; the token guards a loopback endpoint.
const controlUrl = process.env.OMB_CONTROL_URL ?? "";
const controlToken = process.env.OMB_CONTROL_TOKEN ?? "";

const resolved = spawnRuntimeCommand(
  runtime,
  cuaExecArgs(["mcp", "--socket", socket], { container, interactive: true }),
);

runMcpBridge({
  command: resolved.command,
  args: resolved.args,
  label: "Cua Driver",
  // No liveness watchdog: the runtime CLI talks to a local daemon and fails fast on its own.
  ...(controlUrl && controlToken ? { gate: { url: controlUrl, token: controlToken } } : {}),
});
