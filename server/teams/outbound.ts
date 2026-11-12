export interface TeamsReplyTarget {
  appId: string;
  tenantId: string;
  botId: string;
  botGeneration: string;
  memberId: string;
  memberGeneration: string;
  conversationId: string;
  activityId: string;
  serviceUrl: string;
}

export type TeamsReplyResult =
  | { state: "sent" }
  | { state: "unavailable" | "unauthorized" | "invalid" | "unknown" };

export interface TeamsReplyActor {
  appId: string;
  tenantId: string;
  botId: string;
  botGeneration: string;
  memberId: string;
  memberGeneration: string;
}

export interface TeamsOutboundDependencies<Caller> {
  appId: string;
  allowedServiceOrigins: readonly string[];
  authenticateCaller(caller: Caller): Promise<TeamsReplyActor | null>;
  resolveTarget(referenceId: string): Promise<TeamsReplyTarget | null>;
  authorize(actor: TeamsReplyActor, target: TeamsReplyTarget): Promise<boolean>;
  accessToken(appId: string): Promise<string>;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

function pathId(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 512 || value === "." || value === ".." || [...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return false;
  try { encodeURIComponent(value); return true; } catch { return false; }
}

function sameActor(a: TeamsReplyActor, b: TeamsReplyActor): boolean {
  return a.appId === b.appId && a.tenantId === b.tenantId && a.botId === b.botId && a.botGeneration === b.botGeneration && a.memberId === b.memberId && a.memberGeneration === b.memberGeneration;
}

function sameTarget(a: TeamsReplyTarget, b: TeamsReplyTarget): boolean {
  return sameActor(a, b) && a.conversationId === b.conversationId && a.activityId === b.activityId && a.serviceUrl === b.serviceUrl;
}

export function createTeamsOutbound<Caller>(deps: TeamsOutboundDependencies<Caller>) {
  const origins = new Set(deps.allowedServiceOrigins.map((value) => {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("Invalid Teams service origin");
    return url.origin;
  }));
  if (!deps.appId || origins.size === 0) throw new Error("Invalid Teams outbound configuration");
  const request = deps.fetch ?? fetch;
  const timeout = deps.timeoutMs ?? 15_000;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 60_000) throw new Error("Invalid Teams outbound timeout");

  return async (caller: Caller, referenceId: string, text: string): Promise<TeamsReplyResult> => {
    if (!pathId(referenceId) || !text.trim()) return { state: "invalid" };
    const body = JSON.stringify({ type: "message", text });
    if (Buffer.byteLength(body, "utf8") > 28 * 1024) return { state: "invalid" };
    let actor: TeamsReplyActor | null;
    try { actor = await deps.authenticateCaller(caller); } catch { return { state: "unavailable" }; }
    if (!actor || actor.appId !== deps.appId || !actor.tenantId || !actor.botId || !actor.memberId || !pathId(actor.botGeneration) || !pathId(actor.memberGeneration)) return { state: "unauthorized" };
    actor = { ...actor };
    let target: TeamsReplyTarget | null;
    try { target = await deps.resolveTarget(referenceId); } catch { return { state: "unavailable" }; }
    if (!target || !sameActor(actor, target) || !pathId(target.conversationId) || !pathId(target.activityId)) return { state: "unauthorized" };
    target = { ...target };
    let base: URL;
    try { base = new URL(target.serviceUrl); } catch { return { state: "invalid" }; }
    if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash || !origins.has(base.origin)) return { state: "invalid" };
    if (!base.pathname.endsWith("/")) base.pathname += "/";
    let allowed: boolean;
    try { allowed = await deps.authorize(actor, target); } catch { return { state: "unavailable" }; }
    if (!allowed) return { state: "unauthorized" };
    let token: string;
    try { token = await deps.accessToken(deps.appId); } catch { return { state: "unavailable" }; }
    if (!token || token.length > 16_384 || /[\r\n]/.test(token)) return { state: "unavailable" };
    try {
      const currentActor = await deps.authenticateCaller(caller);
      const currentTarget = await deps.resolveTarget(referenceId);
      if (!currentActor || !sameActor(actor, currentActor) || !currentTarget || !sameTarget(target, currentTarget) || !await deps.authorize(currentActor, currentTarget)) return { state: "unauthorized" };
    } catch { return { state: "unavailable" }; }
    const path = `v3/conversations/${encodeURIComponent(target.conversationId)}/activities/${encodeURIComponent(target.activityId)}`;
    const destination = new URL(path, base);
    try {
      const response = await request(destination, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(timeout),
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body,
      });
      await response.body?.cancel().catch(() => {});
      if (response.ok) return { state: "sent" };
      return { state: response.status >= 500 || response.status === 408 ? "unknown" : "unavailable" };
    } catch {
      return { state: "unknown" };
    }
  };
}
