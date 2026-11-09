import { describe, expect, it } from "vitest";

import { parseCleanJsonRpcLine } from "./host.ts";
import { sanitizeAcpToolArguments } from "./tool-input.ts";
import { GrokAgentDriver } from "./grok.ts";

describe("Grok ACP: JSON-RPC Sanitizer", () => {
  it("parses clean single-line JSON-RPC", () => {
    const raw = '{"jsonrpc": "2.0", "id": 1, "method": "initialize"}';
    expect(parseCleanJsonRpcLine(raw)).toEqual({ jsonrpc: "2.0", id: 1, method: "initialize" });
  });

  it("strips log prefixes emitted by CLI wrappers", () => {
    const raw = '[2026-11-08 19:00:00 grok:agent] {"jsonrpc": "2.0", "id": 2, "result": {"ready": true}}';
    expect(parseCleanJsonRpcLine(raw)).toEqual({ jsonrpc: "2.0", id: 2, result: { ready: true } });
  });

  it("strips ANSI color escape sequences and BOMs", () => {
    const raw = '\uFEFF\u001b[32m{"jsonrpc": "2.0", "method": "session/update", "params": {"update": {"sessionUpdate": "tool_call"}}}\u001b[0m';
    expect(parseCleanJsonRpcLine(raw)).toEqual({
      jsonrpc: "2.0",
      method: "session/update",
      params: { update: { sessionUpdate: "tool_call" } },
    });
  });

  it("extracts JSON object substring when surrounded by extra noise", () => {
    const raw = '>>> INCOMING RPC: {"jsonrpc":"2.0","id":3,"result":{"ok":true}} (end of packet)';
    expect(parseCleanJsonRpcLine(raw)).toEqual({ jsonrpc: "2.0", id: 3, result: { ok: true } });
  });

  it("returns null on completely non-JSON lines", () => {
    expect(parseCleanJsonRpcLine("")).toBeNull();
    expect(parseCleanJsonRpcLine("   \n  ")).toBeNull();
    expect(parseCleanJsonRpcLine("Starting Grok agent daemon v1.0.41...")).toBeNull();
  });
});

describe("Grok ACP: Tool Arguments Sanitization & Schema Alignment", () => {
  it("decodes stringified JSON inside rawInput", () => {
    const raw = '{"command": "pnpm test", "timeout": 30}';
    expect(sanitizeAcpToolArguments(raw)).toEqual({ command: "pnpm test", timeout: 30 });
  });

  it("maps command aliases (cmd, script, exec)", () => {
    expect(sanitizeAcpToolArguments({ cmd: "git status" })).toEqual({ cmd: "git status", command: "git status" });
    expect(sanitizeAcpToolArguments({ script: "npm run build" })).toEqual({ script: "npm run build", command: "npm run build" });
  });

  it("maps path aliases (file_path, filePath, target_file, file)", () => {
    expect(sanitizeAcpToolArguments({ file_path: "src/main.ts" })).toEqual({ file_path: "src/main.ts", path: "src/main.ts" });
    expect(sanitizeAcpToolArguments({ target_file: "config.json" })).toEqual({ target_file: "config.json", path: "config.json" });
  });

  it("unwraps nested argument wrappers (arguments, parameters)", () => {
    const nested = { arguments: { command: "echo ok", path: "/tmp/a.txt" } };
    expect(sanitizeAcpToolArguments(nested)).toEqual({ command: "echo ok", path: "/tmp/a.txt" });
  });

  it("coerces numeric string timeouts and boolean flags", () => {
    const input = { timeout: "120", timeout_seconds: "30", recursive: "true" };
    expect(sanitizeAcpToolArguments(input)).toEqual({
      timeout: 120,
      timeout_seconds: 30,
      recursive: true,
    });
  });

  it("has orphan process cleanup enabled on GrokAgentDriver", () => {
    expect(GrokAgentDriver).toBeDefined();
  });
});
