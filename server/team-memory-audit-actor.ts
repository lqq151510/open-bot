import { createHash } from "node:crypto";
import type { DecisionActor } from "./decision-log.ts";

export function teamMemoryAuditActor(actor: DecisionActor | undefined): DecisionActor | undefined {
  if (!actor || actor.kind !== "session") return actor;
  const digest = /^sha256:[a-f0-9]{64}$/.test(actor.sessionId)
    ? actor.sessionId.slice(7)
    : createHash("sha256").update(actor.sessionId).digest("hex");
  return { kind: "session", sessionId: `sha256:${digest}`, label: `Session ${digest.slice(0, 12)}` };
}
