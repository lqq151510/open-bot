// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { BotManagersCard } from "./BotManagersCard";

let host: HTMLDivElement;
let root: Root;
const candidates = [
  { email: "ada@example.test", membershipId: "00000000-0000-4000-8000-000000000001" },
  { email: "ben@example.test", membershipId: "00000000-0000-4000-8000-000000000002" },
];
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0)); };
const mount = async () => { flushSync(() => root.render(createElement(BotManagersCard, { botId: "b1" }))); await settle(); };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const toggle = (index: number) => flushSync(() => host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[index]!.click());
const save = async () => { flushSync(() => [...host.querySelectorAll("button")].find((button) => button.textContent === "Save")!.click()); await settle(); };

beforeEach(() => {
  setLocale("en");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { flushSync(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe("learning managers card", () => {
  it.each([403, 404])("hides management when the server returns %s", async (status) => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "No access" }, status)));
    await mount();
    expect(host.textContent).toBe("");
  });

  it("submits the selected current team members and the original revision", async () => {
    let emails = [candidates[0]!.email];
    const fetch = vi.fn(async (_path: string, init?: RequestInit) => {
      if (init?.method === "PUT") { emails = [candidates[1]!.email]; return json({ emails, revision: "b".repeat(64) }); }
      return json({ emails, revision: "a".repeat(64), candidates });
    });
    vi.stubGlobal("fetch", fetch);
    await mount();
    toggle(0);
    toggle(1);
    await save();
    const put = fetch.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(JSON.parse(String(put?.[1]?.body))).toEqual({ members: [candidates[1]], expectedRevision: "a".repeat(64) });
    expect(host.querySelector('[role="status"]')?.textContent).toContain("Managers updated");
  });

  it("reloads the latest list on conflict instead of overwriting another change", async () => {
    let conflict = false;
    const fetch = vi.fn(async (_path: string, init?: RequestInit) => {
      if (init?.method === "PUT") { conflict = true; return json({ error: "changed" }, 409); }
      return json({ emails: conflict ? [candidates[1]!.email] : [candidates[0]!.email], revision: conflict ? "b".repeat(64) : "a".repeat(64), candidates });
    });
    vi.stubGlobal("fetch", fetch);
    await mount();
    toggle(0);
    await save();
    const boxes = host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(boxes[0]!.checked).toBe(false);
    expect(boxes[1]!.checked).toBe(true);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("choose again before saving");
    expect(fetch.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(1);
  });
});
