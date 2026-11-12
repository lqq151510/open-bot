import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { receiveTeamsRequest } from "./routes.ts";
import type { createTeamsService } from "./service.ts";

describe("Teams ingress route", () => {
  it("requires both credentials and forwards the unchanged bytes to the verified service", async () => {
    const receive = vi.fn(async () => "accepted" as const);
    const service = { receive } as unknown as ReturnType<typeof createTeamsService>;
    const response = () => {
      const state: { status?: number; body?: string } = {};
      const res = { writeHead: (status: number) => { state.status = status; }, end: (body: string) => { state.body = body; } } as unknown as ServerResponse;
      return { state, res };
    };
    const request = (headers: Record<string, string>, body: Buffer) => {
      const req = Readable.from([body]) as IncomingMessage;
      req.headers = headers;
      return req;
    };
    const bytes = Buffer.from('{ "text": "hello" }');
    const denied = response();
    await receiveTeamsRequest(service, request({ authorization: "Bearer token", "content-type": "application/json" }, bytes), denied.res);
    expect(denied.state.status).toBe(401);
    expect(receive).not.toHaveBeenCalled();
    const accepted = response();
    await receiveTeamsRequest(service, request({ authorization: "Bearer token", "x-openbot-teams-proof": "proof", "content-type": "application/json" }, bytes), accepted.res);
    expect(accepted.state.status).toBe(200);
    expect(receive).toHaveBeenCalledWith("Bearer token", bytes, "proof");
  });
});
