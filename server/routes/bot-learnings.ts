import { z } from "zod";
import { BotLearningError, type createBotLearnings } from "../bot-learnings.ts";
import { TEAM_MEMORY_ALIASES_MAX, TEAM_MEMORY_DETAIL_MAX, TEAM_MEMORY_KINDS, TEAM_MEMORY_NAME_MAX } from "../team-memory.ts";
import { PASS, type RouteHandler } from "./table.ts";

const PATH = /^\/api\/bots\/([\w-]+)\/learnings(?:\/([\w-]+))?$/;
const learning = z.object({ kind: z.enum(TEAM_MEMORY_KINDS), name: z.string().trim().min(1).max(TEAM_MEMORY_NAME_MAX), detail: z.string().max(TEAM_MEMORY_DETAIL_MAX),
  aliases: z.array(z.string().max(TEAM_MEMORY_NAME_MAX)).max(TEAM_MEMORY_ALIASES_MAX).optional(), key: z.string().max(240).optional() }).strict();
const proposal = z.object({ explicitlyShared: z.literal(true), learning }).strict();
const decision = z.object({ revision: z.number().int().positive(), action: z.enum(["accept", "reject"]), learning: learning.optional() }).strict();

export function createBotLearningsRoutes(deps: { enabled: boolean; learnings: ReturnType<typeof createBotLearnings> }): RouteHandler {
  return async ({ path, method, auth, req, res, json, readBody }) => {
    const match = PATH.exec(path);
    if (!match || !["GET", "POST", "PATCH"].includes(method)) return PASS;
    if (!deps.enabled || auth.kind !== "session" || auth.session.membershipAuthority !== "team" || auth.session.moveIn || !auth.session.id || !auth.scopes.includes("client")) {
      return json(res, 404, { error: "No such bot or access." });
    }
    const bot = match[1]!; const id = match[2]; const session = auth.session.id;
    try {
      if (method === "GET" && !id) return json(res, 200, { entries: deps.learnings.list(bot, session) });
      if (method === "POST" && !id) {
        const body = proposal.safeParse(await readBody(req));
        if (!body.success) return json(res, 400, { error: "Explicit sharing and a valid learning are required." });
        return json(res, 201, { entry: deps.learnings.propose(bot, session, body.data.learning) });
      }
      if (method === "PATCH" && id) {
        const body = decision.safeParse(await readBody(req));
        if (!body.success || (body.data.action === "reject" && body.data.learning)) return json(res, 400, { error: "A valid review is required." });
        return json(res, 200, { entry: deps.learnings.resolve(bot, session, id, body.data.revision, body.data.action, body.data.learning) });
      }
      return json(res, 404, { error: "No such learning." });
    } catch (error) {
      if (error instanceof BotLearningError) return json(res, error.status, { error: error.message });
      return json(res, 500, { error: "Could not process the learning." });
    }
  };
}
