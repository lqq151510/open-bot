import type { IncomingMessage, ServerResponse } from "node:http";
import { ownerOrAdmin, type RequestAuth } from "../request-auth.ts";
import { PASS, type RouteHandler } from "../routes/table.ts";
import type { createTeamsService } from "./service.ts";

type TeamsService = ReturnType<typeof createTeamsService>;

export function createTeamsControlRoutes(service: TeamsService, memberFor: (auth: RequestAuth) => string | null): RouteHandler {
  return async ({ path, method, auth, res, json }) => {
    if (path === "/api/microsoft-teams/gateway-epoch" && method === "GET") {
      if (!ownerOrAdmin(auth)) return json(res, 403, { error: "Administrator required" });
      res.setHeader("cache-control", "no-store");
      return json(res, 200, { epoch: service.gatewayEpoch });
    }
    if (path !== "/api/microsoft-teams/link") return PASS;
    if (method !== "POST" && method !== "DELETE") return json(res, 405, { error: "Method not allowed" });
    const member = memberFor(auth);
    if (!member) return json(res, 403, { error: "Team membership required" });
    res.setHeader("cache-control", "no-store");
    try {
      if (method === "DELETE") { service.revokeLink(member); return json(res, 200, { ok: true }); }
      return json(res, 200, service.issueLink(member));
    } catch { return json(res, 503, { error: "Teams account linking unavailable" }); }
  };
}

export async function receiveTeamsRequest(service: TeamsService, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const reply = (status: number, body: object) => {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  };
  const authorization = req.headers.authorization;
  const proof = req.headers["x-openbot-teams-proof"];
  if (typeof authorization !== "string" || typeof proof !== "string" || proof.length > 16_384) return reply(401, { error: "Unauthorized" });
  if (!/^application\/json\b/i.test(req.headers["content-type"] ?? "")) return reply(415, { error: "JSON required" });
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of req) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > 1_000_000) return reply(413, { error: "Body too large" });
      chunks.push(bytes);
    }
  } catch { return reply(400, { error: "Invalid body" }); }
  const result = await service.receive(authorization, Buffer.concat(chunks, size), proof);
  const status = result === "unauthorized" ? 401 : result === "conflict" ? 409 :
    result === "busy" || result === "unavailable" ? 503 : 200;
  reply(status, status === 401 ? { error: "Unauthorized" } : { result });
}
