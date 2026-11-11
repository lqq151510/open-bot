// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import type { Disclose } from "./SettingsSimplePages";

const fixture = vi.hoisted(() => ({
  status: 200,
  body: { label: "Fixture-Host.local" } as { label?: string },
}));

vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => true }));
vi.mock("./LocalComputerSection", () => ({ LocalComputerSection: () => null }));
vi.mock("./BrowserSettingsRows", () => ({ BuiltInBrowserRow: () => null, ServerSitesRow: () => null }));
vi.mock("./AppSettingsRows", async (original) => ({ ...await original<object>(), BrowserProfilesRow: () => null }));

const { SimpleComputerPage } = await import("./SettingsSimplePages");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const has = () => true;
const disclose: Disclose = (id) => ({ id, open: false, onToggle: () => {} });
const page = () => createElement(SimpleComputerPage, {
  has, disclose, remoteAccess: { client: null, domain: null, pairing: null, companion: null }, servers: null,
});

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  setLocale("en");
  fixture.status = 200;
  fixture.body = { label: "Fixture-Host.local" };
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/.well-known/openbot/environment")) {
      return Promise.resolve(new Response(JSON.stringify(fixture.body), {
        status: fixture.status,
        headers: { "content-type": "application/json" },
      }));
    }
    return Promise.resolve(new Response("{}", { status: 404, headers: { "content-type": "application/json" } }));
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("managed devices", () => {
  it("does not paint the sample computer or phones before a name arrives", () => {
    const html = renderToStaticMarkup(page());
    expect(html).toContain("Reading this computer…");
    expect(html).not.toContain("MacBook-Pro-3728.local");
    expect(html).not.toContain("V2606A");
    expect(html).not.toContain("上次打开");
  });

  it("shows this computer's hostname once the environment answers", async () => {
    await act(async () => { root.render(page()); });
    await vi.waitFor(() => {
      expect(host.querySelector("[data-managed-devices='this-computer']")?.textContent).toContain("Fixture-Host.local");
    });
    expect(host.textContent).toContain("Computer");
    expect(host.textContent).toContain("Online");
    expect(host.textContent).not.toContain("V2606A");
    expect(host.textContent).not.toContain("MacBook-Pro-3728.local");
  });

  it("stays empty when this computer's name cannot be read", async () => {
    fixture.status = 503;
    await act(async () => { root.render(page()); });
    await vi.waitFor(() => {
      expect(host.querySelector("[data-managed-devices='empty']")?.textContent).toContain("This computer's name isn't available.");
    });
    expect(host.textContent).not.toContain("Fixture-Host.local");
    expect(host.textContent).not.toContain("V2606A");
    expect(host.textContent).not.toContain("Online");
  });
});
