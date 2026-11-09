// Tool-argument repair and reasoning-replay detection shared by the ACP driver.
// Kept out of core.ts so the driver file stays under the repository's size ratchet.
/** Auto-align and repair malformed tool arguments from stdio CLI messages. */
export function sanitizeAcpToolArguments(rawInput: unknown): Record<string, unknown> {
  let input: any = rawInput;
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        input = JSON.parse(trimmed);
      } catch {
        input = { command: trimmed };
      }
    } else {
      input = { command: trimmed };
    }
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};

  if (input.arguments && typeof input.arguments === "object" && !Array.isArray(input.arguments)) {
    input = { ...input.arguments, ...input };
    delete input.arguments;
  } else if (input.parameters && typeof input.parameters === "object" && !Array.isArray(input.parameters)) {
    input = { ...input.parameters, ...input };
    delete input.parameters;
  }

  const normalized: Record<string, unknown> = { ...input };

  if (normalized.command === undefined) {
    if (typeof normalized.cmd === "string") normalized.command = normalized.cmd;
    else if (typeof normalized.script === "string") normalized.command = normalized.script;
    else if (typeof normalized.exec === "string") normalized.command = normalized.exec;
  }
  if (normalized.path === undefined) {
    if (typeof normalized.file_path === "string") normalized.path = normalized.file_path;
    else if (typeof normalized.filePath === "string") normalized.path = normalized.filePath;
    else if (typeof normalized.target_file === "string") normalized.path = normalized.target_file;
    else if (typeof normalized.file === "string") normalized.path = normalized.file;
  }
  if (normalized.content === undefined) {
    if (typeof normalized.text === "string") normalized.content = normalized.text;
    else if (typeof normalized.body === "string") normalized.content = normalized.body;
  }
  if (normalized.query === undefined) {
    if (typeof normalized.pattern === "string") normalized.query = normalized.pattern;
    else if (typeof normalized.search === "string") normalized.query = normalized.search;
  }

  if (typeof normalized.timeout === "string" && /^\d+$/.test(normalized.timeout)) {
    normalized.timeout = Number(normalized.timeout);
  }
  if (typeof normalized.timeout_seconds === "string" && /^\d+$/.test(normalized.timeout_seconds)) {
    normalized.timeout_seconds = Number(normalized.timeout_seconds);
  }
  if (typeof normalized.recursive === "string") {
    normalized.recursive = normalized.recursive === "true";
  }

  return normalized;
}

export function isHermesReasoningReplay(chunk: string, streamed: string): boolean {
  const reply = streamed.trim();
  const replay = chunk.trim();
  return reply !== "" && /^(?:> |-# )?💭/.test(replay) && replay.endsWith(reply)
    && /\n\n[ \t]*$/.test(replay.slice(0, -reply.length));
}

