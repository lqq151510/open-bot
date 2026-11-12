// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { BotLearningsCard } from "./BotLearningsCard";

let host: HTMLDivElement;
let root: Root;
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0)); };
const mount = async () => { flushSync(() => root.render(createElement(BotLearningsCard, { botId: "b1" }))); await settle(); };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  setLocale("en");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { flushSync(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe("team learnings card", () => {
  it("does not expose the feature when the server denies access", async () => {
    const fetch = vi.fn(async () => json({ error: "No such bot or access." }, 404));
    vi.stubGlobal("fetch", fetch);
    await mount();
    expect(host.textContent).toBe("");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("lets a reviewer approve with the displayed revision and refreshes the queue", async () => {
    const entries = [{ id: "l1", kind: "term", name: "Release", detail: "Use the checklist", state: "proposed", revision: 3 }];
    const fetch = vi.fn(async (path: string, init?: RequestInit) => {
      if (path.endsWith("learning-capabilities")) return json({ canPropose: true, canReview: true });
      if (init?.method === "PATCH") { entries[0]!.state = "accepted"; return json({ entry: entries[0] }); }
      return json({ entries });
    });
    vi.stubGlobal("fetch", fetch);
    await mount();
    expect(host.textContent).toContain("Use the checklist");
    const approve = [...host.querySelectorAll("button")].find((button) => button.textContent === "Approve")!;
    flushSync(() => approve.click());
    await settle();
    const request = fetch.mock.calls.find(([path, init]) => path.endsWith("/l1") && init?.method === "PATCH");
    expect(JSON.parse(String(request?.[1]?.body))).toEqual({ revision: 3, action: "accept" });
    expect(host.textContent).toContain("No learnings waiting for review.");
  });

  it("refreshes stale decisions and keeps the conflict message visible", async () => {
    let revision = 1;
    const fetch = vi.fn(async (path: string, init?: RequestInit) => {
      if (path.endsWith("learning-capabilities")) return json({ canPropose: true, canReview: true });
      if (init?.method === "PATCH") { revision = 2; return json({ error: "Learning changed. Reload and try again." }, 409); }
      return json({ entries: [{ id: "l1", kind: "term", name: "Release", detail: "Use the checklist", state: "proposed", revision }] });
    });
    vi.stubGlobal("fetch", fetch);
    await mount();
    flushSync(() => [...host.querySelectorAll("button")].find((button) => button.textContent === "Reject")!.click());
    await settle();
    expect(host.querySelector("[role=alert]")?.textContent).toContain("Learning changed.");
    const request = fetch.mock.calls.find(([path, init]) => path.endsWith("/l1") && init?.method === "PATCH");
    expect(JSON.parse(String(request?.[1]?.body))).toEqual({ revision: 1, action: "reject" });
    expect(fetch.mock.calls.filter(([path]) => path.endsWith("/learnings"))).toHaveLength(2);
  });

  it("shows a proposal form but does not request the review queue for an ordinary member", async () => {
    const fetch = vi.fn(async () => json({ canPropose: true, canReview: false }));
    vi.stubGlobal("fetch", fetch);
    await mount();
    expect(host.textContent).toContain("Propose a team learning");
    expect(host.textContent).not.toContain("Waiting for review");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
