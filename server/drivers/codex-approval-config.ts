import type { ApprovalMode } from "../../shared/approval-mode.ts";

export interface CodexApprovalParams {
  thread: Record<string, unknown>;
  turn: Record<string, unknown>;
  /** Legacy settings for an older app-server that rejects the named-profile field. */
  fallback?: Omit<CodexApprovalParams, "fallback">;
}

/** Codex persists these on its native thread, so they are explicit on start, resume and every turn.
 * Codex has no narrower "edits only" sandbox, so a stray Edits value asks. */
export function namedApprovalParams(mode: Exclude<ApprovalMode, "custom">, approvalRules = false): CodexApprovalParams {
  if (mode === "full") {
    return {
      thread: {
        approvalPolicy: "never",
        approvalsReviewer: "user",
        sandbox: "danger-full-access",
      },
      turn: {
        approvalPolicy: "never",
        approvalsReviewer: "user",
        sandboxPolicy: { type: "dangerFullAccess" },
      },
    };
  }
  return {
    thread: {
      approvalPolicy: approvalRules ? "untrusted" : "on-request",
      approvalsReviewer: mode === "auto" ? "auto_review" : "user",
      sandbox: "workspace-write",
    },
    turn: {
      approvalPolicy: approvalRules ? "untrusted" : "on-request",
      approvalsReviewer: mode === "auto" ? "auto_review" : "user",
      sandboxPolicy: { type: "workspaceWrite" },
    },
  };
}

const plainRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

export function assertCodexApprovalMounts(config: unknown, names: Iterable<string>): void {
  const catalog = plainRecord(plainRecord(config)?.mcp_servers);
  for (const name of names) {
    const mount = plainRecord(catalog?.[name]);
    const tools = plainRecord(mount?.tools);
    const overrides = Object.values(tools ?? {}).map(plainRecord);
    if (mount?.default_tools_approval_mode !== "prompt" || (mount.tools != null && !tools) ||
      overrides.some(tool => !tool || (tool.enabled !== false && tool.approval_mode != null && tool.approval_mode !== "prompt"))) {
      throw new Error("Codex could not confirm approval for an OpenBot tool server. No prompt was sent.");
    }
  }
}

/** A Custom approval_policy as Codex accepts it: a named policy, or a granular record with only the keys it knows. */
export function effectiveApprovalPolicy(value: unknown): unknown {
  if (value === "untrusted" || value === "on-request" || value === "never") return value;
  const granular = plainRecord(plainRecord(value)?.granular);
  if (
    granular &&
    typeof granular.mcp_elicitations === "boolean" &&
    typeof granular.rules === "boolean" &&
    typeof granular.sandbox_approval === "boolean" &&
    (granular.request_permissions === undefined || typeof granular.request_permissions === "boolean") &&
    (granular.skill_approval === undefined || typeof granular.skill_approval === "boolean")
  ) {
    return {
      granular: {
        mcp_elicitations: granular.mcp_elicitations,
        rules: granular.rules,
        sandbox_approval: granular.sandbox_approval,
        ...(typeof granular.request_permissions === "boolean"
          ? { request_permissions: granular.request_permissions }
          : {}),
        ...(typeof granular.skill_approval === "boolean"
          ? { skill_approval: granular.skill_approval }
          : {}),
      },
    };
  }
  return "on-request";
}

export function effectiveApprovalsReviewer(value: unknown): string {
  return value === "auto_review" || value === "guardian_subagent" ? value : "user";
}
