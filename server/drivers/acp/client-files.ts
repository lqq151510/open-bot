import { lstat, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { newId, type RuntimeEvent } from "../../contracts.ts";
import { redactSecretsInText } from "../../redact.ts";
import { toolRuleRequiresApproval } from "../tool-rule-approval.ts";
import type { AcpTurn } from "./turn-state.ts";

const CLIENT_FILE_MAX_BYTES = 8 * 1024 * 1024;
type ClientFileMethod = "fs/read_text_file" | "fs/write_text_file";
type ClientFileTurn = Pick<AcpTurn, "turn" | "asks" | "flushAssistantText"> & {
  state: Pick<AcpTurn["state"], "stopped" | "cancelling" | "settled">;
};
type EventBase = Pick<RuntimeEvent, "eventId" | "provider" | "threadId" | "turnId" | "createdAt">;

function assertWithin(workspace: string, path: string): void {
  const rel = relative(workspace, path);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error("ACP file path is outside the session workspace.");
  }
}

async function resolveClientPath(cwd: string, requestPath: unknown): Promise<string> {
  if (typeof requestPath !== "string" || !isAbsolute(requestPath)) {
    throw new Error("ACP file paths must be absolute.");
  }
  const workspace = await realpath(cwd).catch(() => resolve(cwd));
  const requested = resolve(requestPath);
  assertWithin(resolve(cwd), requested);
  const suffix = [basename(requested)];
  let ancestor = dirname(requested);
  while (!(await lstat(ancestor).catch(() => null))) {
    const parent = dirname(ancestor);
    if (parent === ancestor) throw new Error("ACP file path has no accessible parent.");
    suffix.unshift(basename(ancestor));
    ancestor = parent;
  }
  const candidate = resolve(await realpath(ancestor), ...suffix);
  assertWithin(workspace, candidate);
  if ((await lstat(candidate).catch(() => null))?.isSymbolicLink()) {
    throw new Error("ACP file path cannot be a symbolic link.");
  }
  return candidate;
}

function askAboutClientFile(
  current: ClientFileTurn, tool: ClientFileMethod, path: string, emit: (event: RuntimeEvent) => void, base: () => EventBase,
): Promise<boolean> {
  const requestId = newId();
  return new Promise((resolve) => {
    const timer = setTimeout(() => current.asks.get(requestId)?.("deny", "timeout"), 15 * 60_000);
    timer.unref?.();
    current.asks.set(requestId, (behavior, source = "user") => {
      if (!current.asks.delete(requestId)) return "unavailable";
      clearTimeout(timer);
      const allowed = behavior === "allow";
      emit({ ...base(), type: "request.resolved", requestId, behavior: allowed ? "allow" : "deny", source });
      resolve(allowed);
      return allowed ? "allowed-once" : "rejected";
    });
    current.flushAssistantText();
    emit({ ...base(), type: "request.opened", requestId, requestType: "permission", tool,
      summary: redactSecretsInText(path).slice(0, 200), alwaysAskRequired: true });
  });
}

export async function runAcpClientFileRequest(options: {
  method: ClientFileMethod;
  params: { path?: unknown; line?: unknown; limit?: unknown; content?: unknown };
  cwd: string;
  current: ClientFileTurn;
  emit(event: RuntimeEvent): void;
  base(): EventBase;
}): Promise<{ content: string } | Record<string, never>> {
  const { method, params, cwd, current, emit, base } = options;
  const assertActive = () => {
    if (current.state.stopped || current.state.cancelling || current.state.settled) {
      throw new Error("ACP file request was interrupted.");
    }
  };
  assertActive();
  let path = await resolveClientPath(cwd, params.path);
  if (await toolRuleRequiresApproval(current.turn, { tool: method })) {
    assertActive();
    if (!await askAboutClientFile(current, method, path, emit, base)) throw new Error("ACP file request was denied.");
    const confirmedPath = await resolveClientPath(cwd, params.path);
    if (path !== confirmedPath) throw new Error("ACP file path changed while waiting for approval.");
    path = confirmedPath;
  }
  assertActive();
  if (method === "fs/read_text_file") {
    const info = await stat(path);
    if (!info.isFile() || info.size > CLIENT_FILE_MAX_BYTES) {
      throw new Error(`ACP can only read text files under ${CLIENT_FILE_MAX_BYTES} bytes.`);
    }
    assertActive();
    const content = await readFile(path, "utf8");
    if (params.line == null && params.limit == null) return { content };
    const line = typeof params.line === "number" && Number.isInteger(params.line) && params.line > 0 ? params.line : 1;
    const limit = typeof params.limit === "number" && Number.isInteger(params.limit) && params.limit >= 0 ? params.limit : undefined;
    const start = line - 1;
    return { content: content.split("\n").slice(start, limit === undefined ? undefined : start + limit).join("\n") };
  }
  if (typeof params.content !== "string" || Buffer.byteLength(params.content) > CLIENT_FILE_MAX_BYTES) {
    throw new Error(`ACP can only write text files under ${CLIENT_FILE_MAX_BYTES} bytes.`);
  }
  await mkdir(dirname(path), { recursive: true });
  assertActive();
  await writeFile(path, params.content, "utf8");
  return {};
}
