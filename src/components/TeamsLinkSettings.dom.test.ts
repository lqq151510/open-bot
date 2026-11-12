// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { TeamsLinkSettings } from "./TeamsLinkSettings";

let host: HTMLDivElement;
let root: Root;
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0)); };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const click = async (label: string) => {
  flushSync(() => [...host.querySelectorAll("button")].find((button) => button.textContent === label)!.click());
  await settle();
};

beforeEach(() => {
  setLocale("en");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { flushSync(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe("Teams account linking", () => {
  it("only creates an ephemeral code after an explicit action and removes it on disconnect", async () => {
    const secret = "a".repeat(43);
    const fetch = vi.fn(async (_path: string, init?: RequestInit) => init?.method === "POST"
      ? json({ secret, expiresAt: Date.now() + 60_000 }) : json({ ok: true }));
    vi.stubGlobal("fetch", fetch);
    flushSync(() => root.render(createElement(TeamsLinkSettings)));
    expect(fetch).not.toHaveBeenCalled();
    await click("Create linking code");
    expect(host.textContent).toContain(`/openbot-link ${secret}`);
    expect(fetch.mock.calls[0]?.[1]?.method).toBe("POST");
    await click("Disconnect");
    expect(fetch.mock.calls[1]?.[1]?.method).toBe("DELETE");
    expect(host.textContent).not.toContain(secret);
    expect(host.querySelector('[role="status"]')?.textContent).toContain("removed");
  });

  it.each([403, 404])("shows unavailable when the server returns %s", async (status) => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "unavailable" }, status)));
    flushSync(() => root.render(createElement(TeamsLinkSettings)));
    await click("Create linking code");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("not configured");
    expect(host.querySelector("code")).toBeNull();
  });

  it("does not display an expired code", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ secret: "a".repeat(43), expiresAt: Date.now() - 1 })));
    flushSync(() => root.render(createElement(TeamsLinkSettings)));
    await click("Create linking code");
    expect(host.querySelector("code")).toBeNull();
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
  });
});
