import { expect, it } from "vitest";
import { launchCloudSendFixture } from "../scripts/testing/cloud-send-fixture.ts";

it("rejects the same signed pairing after the isolated cloud server restarts", async () => {
  const fixture = await launchCloudSendFixture({ onePasswordToken: "ops_fixture_nonce", team: { id: "team-nonce", name: "Fixture", noAi: true } });
  const originalFetch = globalThis.fetch;
  let captured: RequestInit | undefined;
  try {
    const team = fixture.team!;
    globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (String(input) === `${team.base}/api/cloud/pairing` && init) captured = { ...init, headers: new Headers(init.headers) };
      return originalFetch(input, init);
    }) as typeof fetch;
    await team.grant({ email: "owner@example.test", role: "owner" });
    globalThis.fetch = originalFetch;
    expect(captured).toBeDefined();
    await team.relaunch();
    const response = await originalFetch(`${team.base}/api/cloud/pairing`, captured);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "replayed_request" });
  } finally {
    globalThis.fetch = originalFetch;
    await fixture.close();
  }
}, 60_000);
