// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale, t } from "@/lib/i18n";
import type { Disclose } from "./SettingsSimplePages";
import type { ComputerImageUpdates } from "../../shared/computer-image-updates";
import type { DeviceAccessPatch, DeviceAccessState } from "../../shared/device-access";

const fixture = vi.hoisted(() => ({
  status: 200,
  body: { label: "Fixture-Host.local" } as { label?: string },
  images: { status: "unavailable", computers: [], unverified: false } as ComputerImageUpdates,
  phones: [] as unknown[],
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
  fixture.images = { status: "unavailable", computers: [], unverified: false };
  fixture.phones = [];
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/.well-known/openbot/environment")) {
      return Promise.resolve(new Response(JSON.stringify(fixture.body), {
        status: fixture.status,
        headers: { "content-type": "application/json" },
      }));
    }
    if (url === "/api/computers/image-updates") return Promise.resolve(Response.json(fixture.images));
    if (url === "/api/phones") return Promise.resolve(Response.json({ phones: fixture.phones }));
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
    expect(html).not.toContain(t("settings.computer.upToDate"));
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

  it("shows verified image status and refreshes without reusing a stale result", async () => {
    fixture.images = {
      status: "busy", unverified: true,
      computers: [{ id: "fixture-vm", name: "Fixture VM", provider: "local-vm", status: "busy" }],
    };
    await act(async () => { root.render(page()); });
    expect(host.textContent).toContain("Waiting for work to finish");
    expect(host.textContent).toContain("Fixture VM");
    expect(host.textContent).toContain("Some computer images could not be verified.");

    fixture.images = { status: "ready", unverified: false, computers: [] };
    const check = [...host.querySelectorAll("button")].find((button) => button.textContent === "Check images")!;
    await act(async () => { check.click(); });
    expect(host.textContent).toContain("Image update available");
    expect(host.textContent).not.toContain("Waiting for work to finish");
  });

  it("sets desktop device permissions through the bridge and keeps confirmed state on failure", async () => {
    let saved: DeviceAccessState = { execution: "ask", forwardTraffic: true };
    const set = vi.fn(async (patch: DeviceAccessPatch) => { saved = { ...saved, ...patch }; return saved; });
    vi.stubGlobal("ogb", { deviceAccess: { state: async () => saved, set } });
    await act(async () => { root.render(page()); });
    const select = host.querySelector<HTMLSelectElement>("[aria-label='Execute on this computer']")!;
    const relay = host.querySelector<HTMLButtonElement>("[aria-label='Route traffic through this computer']")!;
    expect(select.value).toBe("ask");
    await act(async () => { select.value = "never"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(set).toHaveBeenCalledWith({ execution: "never" });
    expect(select.value).toBe("never");
    await act(async () => { relay.click(); });
    expect(set).toHaveBeenCalledWith({ forwardTraffic: false });
    expect(relay.getAttribute("aria-checked")).toBe("false");
    set.mockRejectedValueOnce(new Error("disk error"));
    await act(async () => { relay.click(); });
    expect(relay.getAttribute("aria-checked")).toBe("false");
    expect(host.textContent).toContain("Could not save the device settings.");
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

  it("renders paired phones in managed devices list alongside the local computer", async () => {
    fixture.phones = [{
      key: "companion:p1",
      registration: { installId: "i1", name: "Pixel 9", platform: "android", appVersion: "1.0", timeZone: "UTC", capabilities: {} },
      registeredAt: Date.now() - 4 * 86_400_000,
      seen: Date.now() - 4 * 86_400_000,
      lastUsedAt: null,
      online: false,
      busy: false,
    }];
    await act(async () => { root.render(page()); });
    await vi.waitFor(() => {
      expect(host.querySelector("[data-managed-devices='this-computer']")?.textContent).toContain("Fixture-Host.local");
      expect(host.textContent).toContain("Pixel 9");
      expect(host.textContent).toContain("Android");
    });
  });

  it("displays up-to-date banner when image update status is current", async () => {
    fixture.images = {
      status: "current", unverified: false,
      computers: [{ id: "vm-1", name: "Local VM", provider: "local-vm", status: "current" }],
    };
    await act(async () => { root.render(page()); });
    await vi.waitFor(() => {
      expect(host.textContent).toContain("Your computer is up to date");
    });
  });
});
