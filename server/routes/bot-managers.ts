import { z } from "zod";
import { botOwner, ownerEmail } from "../../shared/bot-owner.ts";
import { BotManagersError, type createBotManagers } from "../bot-managers.ts";
import type { RequestAuth } from "../request-auth.ts";
import type { BotRecord } from "../store.ts";
import { PASS, type RouteHandler } from "./table.ts";

const PATH = /^\/api\/bots\/([\w-]{1,128})\/managers$/;
const replacement = z.object({ members: z.array(z.object({ email: z.string().min(3).max(254), membershipId: z.string().uuid() }).strict()).max(100), expectedRevision: z.string().regex(/^[a-f0-9]{64}$/) }).strict();

export interface BotManagersRouteDeps {
  enabled: boolean;
  bot(id: string): BotRecord | null | undefined;
  canSee(auth: RequestAuth, id: string): boolean;
  isCurrentSession(email: string, id: string): boolean;
  currentTeamRole(email: string, id: string): "owner" | "admin" | "member" | null;
  candidates(): Array<{ email: string; membershipId: string }>;
  managers: ReturnType<typeof createBotManagers>;
}

export function createBotManagersRoutes(deps: BotManagersRouteDeps): RouteHandler {
  const authorized = (auth: RequestAuth, id: string): boolean => {
    if (!deps.enabled || auth.kind !== "session" || auth.session.membershipAuthority !== "team" || !auth.session.email || !auth.session.teamRole || auth.session.moveIn) return false;
    const email = ownerEmail(auth.session.email);
    if (!deps.isCurrentSession(email, auth.session.id) || !deps.canSee(auth, id)) return false;
    const bot = deps.bot(id);
    if (!bot || bot.defaultBot?.person) return false;
    try {
      const role = deps.currentTeamRole(email, auth.session.id);
      return (auth.scopes.includes("admin") && (role === "owner" || role === "admin")) || (role !== null && botOwner(bot) === email);
    } catch { return false; }
  };
  return async ({ path, method, auth, res, json, readBody, req }) => {
    const match = PATH.exec(path);
    if (!match || (method !== "GET" && method !== "PUT")) return PASS;
    const id = match[1]!;
    if (!authorized(auth, id)) return json(res, 404, { error: "No such bot or access." });
    try {
      if (method === "GET") return json(res, 200, { ...deps.managers.list(id), candidates: deps.candidates() });
      const parsed = replacement.safeParse(await readBody(req));
      if (!parsed.success) return json(res, 400, { error: "Send manager emails and the expected revision." });
      if (!authorized(auth, id)) return json(res, 404, { error: "No such bot or access." });
      return json(res, 200, deps.managers.replace(id, parsed.data.members, parsed.data.expectedRevision));
    } catch (error) {
      if (error instanceof BotManagersError) return json(res, error.status, { error: error.message });
      return json(res, 500, { error: "Could not save manager grants." });
    }
  };
}
