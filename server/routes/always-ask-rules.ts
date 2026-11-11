import type { AlwaysAskRulesResponse } from "../../shared/always-ask-rules.ts";
import type { AlwaysAskRules } from "../always-ask-rules.ts";
import type { RequestAuth } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

export function createAlwaysAskRoutes(deps: {
  rules: AlwaysAskRules;
  person(auth: RequestAuth): string | undefined;
  canManageTeam(auth: RequestAuth): boolean;
  turnsRunning(): boolean;
  semanticReview(): boolean;
}): RouteHandler {
  return async ({ req, res, path, method, auth, url, json, readBody }) => {
    const match = /^\/api\/permission-rules\/always-ask(?:\/([\w-]+))?$/.exec(path);
    if (!match) return PASS;
    const person = deps.person(auth);
    if (!person) return json(res, 403, { error: "A workspace member must sign in to view always-ask rules." });
    const canEditTeam = deps.canManageTeam(auth);
    const scope = url.searchParams.get("scope") ?? "team";
    if (scope !== "personal" && scope !== "team") return json(res, 400, { error: "Unknown always-ask rule scope." });
    if (method !== "GET" && scope === "team" && !canEditTeam) {
      return json(res, 403, { error: "Only the owner or a workspace admin can manage team rules." });
    }
    const owner = scope === "personal" ? person : undefined;
    const id = match[1];
    if (method === "POST" && !id) {
      const body = await readBody(req, 2_048);
      if (!deps.rules.activeFor(owner) && deps.turnsRunning()) {
        return json(res, 409, { code: "always_ask_busy", error: "Wait for running bot turns to finish before adding the first always-ask rule." });
      }
      deps.rules.create(body?.text, owner);
    } else if (method === "PATCH" && id) {
      const body = await readBody(req, 2_048);
      deps.rules.update(id, body?.text, owner);
    } else if (method === "DELETE" && id) {
      deps.rules.delete(id, owner);
    } else if (method !== "GET" || id) {
      return json(res, 405, { error: "Unsupported always-ask rule operation." });
    }
    const teamRules = deps.rules.list();
    const response: AlwaysAskRulesResponse = {
      rules: teamRules, personalRules: deps.rules.list(person), teamRules,
      canEditPersonal: true, canEditTeam, semanticReview: deps.semanticReview(),
    };
    return json(res, 200, response);
  };
}
