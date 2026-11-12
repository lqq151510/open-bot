import { describe, expect, it, vi } from "vitest";
import { createTeamsAccessToken } from "./access-token.ts";

const appId = "11111111-1111-4111-8111-111111111111";
const tenantId = "22222222-2222-4222-8222-222222222222";

describe("Teams access token", () => {
  it("requests the Bot Framework scope, caches and refreshes without exposing the secret", async () => {
    let clock = 1;
    const request = vi.fn(async () => new Response(JSON.stringify({ access_token: "fake-token", expires_in: 120 }), { status: 200 }));
    const getToken = createTeamsAccessToken({ appId, tenantId, clientSecret: "test-secret" }, { fetch: request as typeof fetch, monotonic: () => clock });
    expect(await Promise.all([getToken(appId), getToken(appId)])).toEqual(["fake-token", "fake-token"]);
    expect(request).toHaveBeenCalledTimes(1);
    const [url, init] = request.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`);
    expect((init.body as URLSearchParams).get("scope")).toBe("https://api.botframework.com/.default");
    expect(init.redirect).toBe("error");
    clock = 90_002;
    expect(await getToken(appId)).toBe("fake-token");
    expect(request).toHaveBeenCalledTimes(2);
    await expect(getToken("wrong-app")).rejects.toThrow("Invalid Teams app");
    clock = 1;
    await expect(getToken(appId)).rejects.toThrow("Teams token unavailable");
  });

  it("rejects malformed token responses and retries a subsequent request", async () => {
    const request = vi.fn().mockResolvedValueOnce(new Response('{"access_token":"bad\\ntoken","expires_in":3600}'))
      .mockResolvedValueOnce(new Response('{"access_token":"ok","expires_in":3600}'));
    const getToken = createTeamsAccessToken({ appId, tenantId, clientSecret: "test-secret" }, { fetch: request as typeof fetch });
    await expect(getToken(appId)).rejects.toThrow("Teams token unavailable");
    expect(await getToken(appId)).toBe("ok");
  });
});
