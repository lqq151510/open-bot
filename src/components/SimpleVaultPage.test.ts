// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ api: vi.fn(), admin: true as boolean | null, dispatch: vi.fn() }));
vi.mock("@/state/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/state/store")>();
  return {
    ...actual,
    api: fixture.api,
    useStore: () => ({
      state: { ...actual.initialState, bots: [{ id: "pepper", name: "Pepper" }], config: null, appSettingsSection: "logins" as const },
      dispatch: fixture.dispatch,
    }),
  };
});
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => fixture.admin }));
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => false, setAdvancedMode: vi.fn() }));
const { SimpleVaultPage } = await import("./SettingsSimplePages");
const { SettingsModal } = await import("./SettingsModal");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;

const OFF = { connected: false };
const SAVED = {
  id: "l2", site: "example.org", hosts: ["crm.example.org"], exactHost: false, username: "team", hasTotp: false,
  source: "settings", bots: "all", createdAt: 2,
  password: "fake-leaked-pass",
};

beforeEach(() => {
  fixture.api.mockReset();
  fixture.dispatch.mockReset();
  fixture.admin = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function render() {
  await act(async () => root.render(createElement(SimpleVaultPage)));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}
const tab = (id: string) => host.querySelector<HTMLButtonElement>(`[data-vault-tab="${id}"]`)!;
const tabText = (id: string) => tab(id).textContent!.replace(/\s+/g, " ").trim();
async function openTab(id: string) {
  await act(async () => tab(id).click());
}
const button = (label: string) => [...host.querySelectorAll("button")].find((candidate) => (candidate.getAttribute("aria-label") ?? candidate.textContent) === label)!;
async function click(label: string) { await act(async () => button(label).click()); }
async function type(name: string, value: string) {
  const input = host.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function submit() {
  await act(async () => { host.querySelector<HTMLFormElement>("[data-login-form]")!.requestSubmit(); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

describe("Vault logins", () => {
  it("lists a saved login by site and username, and does not render a password that arrived with it", async () => {
    fixture.api.mockResolvedValueOnce({ logins: [SAVED], onePassword: OFF });
    await render();
    await openTab("logins");
    const row = host.querySelector("[data-login-row]")!;
    expect(row.textContent).toContain("example.org");
    expect(row.textContent).toContain("team");
    expect(row.textContent).not.toContain("fake-leaked-pass");
    expect(host.innerHTML).not.toContain("fake-leaked-pass");
    expect(tabText("all")).toBe("All 1");
    expect(tabText("logins")).toBe("Logins 1");
    expect(tabText("payments")).toBe("Payments 0");
    expect(tabText("contacts")).toBe("Contact info 0");
    expect(host.textContent).not.toContain("示例联系人");
    expect(host.textContent).not.toContain("示例邮箱");
    expect(host.textContent).not.toContain("我的资料");
    expect(fixture.api).toHaveBeenCalledWith("/api/logins");
  });

  it("says when there is nothing saved", async () => {
    fixture.api.mockResolvedValueOnce({ logins: [], onePassword: OFF });
    await render();
    await openTab("logins");
    expect(host.textContent).toContain("No saved logins yet.");
    expect(host.querySelector("[data-login-row]")).toBeNull();
    expect(tabText("all")).toBe("All 0");
    expect(tabText("logins")).toBe("Logins 0");
    expect(tabText("contacts")).toBe("Contact info 0");
  });

  it("saves through the login API and drops the password from the page", async () => {
    fixture.api.mockResolvedValueOnce({ logins: [], onePassword: OFF }).mockResolvedValueOnce({ login: SAVED }).mockResolvedValueOnce({ logins: [SAVED], onePassword: OFF });
    await render();
    await openTab("logins");
    await click("Add login");
    await type("site", "crm.example.org");
    await type("username", "team");
    await type("password", "fake-typed-pass");
    await submit();
    expect(fixture.api).toHaveBeenNthCalledWith(2, "/api/logins", {
      method: "POST",
      body: JSON.stringify({ site: "crm.example.org", username: "team", password: "fake-typed-pass", bots: "all" }),
    });
    expect(host.querySelector("[data-login-form]")).toBeNull();
    expect(host.innerHTML).not.toContain("fake-typed-pass");
    expect(host.innerHTML).not.toContain("fake-leaked-pass");
    expect(host.querySelector("[data-login-row]")!.textContent).toContain("team");
    expect(tabText("logins")).toBe("Logins 1");
  });

  it("leaves payments empty, with no card field and no login form", async () => {
    fixture.api.mockResolvedValueOnce({ logins: [SAVED], onePassword: OFF });
    await render();
    await openTab("payments");
    expect(tabText("payments")).toBe("Payments 0");
    expect(host.textContent).toContain("没有匹配的项目");
    expect(host.querySelector("[data-login-row], [data-login-form], input[name='password'], input[autocomplete='cc-number']")).toBeNull();
    expect(fixture.api.mock.calls.map((call) => call[0])).toEqual(["/api/logins"]);
  });

  it("shows the existing empty copy for contacts, with no saved rows and no password text", async () => {
    fixture.api.mockResolvedValueOnce({ logins: [SAVED], onePassword: OFF });
    await render();
    await openTab("contacts");
    expect(tabText("contacts")).toBe("Contact info 0");
    expect(host.textContent).toContain("没有匹配的项目");
    expect(host.textContent).not.toContain("示例联系人");
    expect(host.textContent).not.toContain("示例邮箱");
    expect(host.textContent).not.toContain("我的资料");
    expect(host.textContent).not.toContain("contact@example.com");
    expect(host.querySelector("[data-login-row], [data-login-form], input[name='password']")).toBeNull();
    expect(host.innerHTML).not.toContain("fake-leaked-pass");
  });

  it("opens the existing add-login form from New item, including from the empty contacts tab", async () => {
    fixture.api.mockResolvedValue({ logins: [SAVED], onePassword: OFF });
    await act(async () => root.render(createElement(SettingsModal)));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(host.querySelector("[data-login-form]")).toBeNull();
    expect(host.innerHTML).not.toContain("fake-leaked-pass");
    await openTab("contacts");
    expect(tabText("contacts")).toBe("Contact info 0");
    await click("New item");
    const form = host.querySelector<HTMLFormElement>("[data-login-form]");
    const secret = host.querySelector<HTMLInputElement>("input[name='password']");
    expect(form).not.toBeNull();
    expect(host.querySelectorAll("[data-login-form]")).toHaveLength(1);
    expect(secret?.type).toBe("password");
    expect(secret?.value).toBe("");
    expect(tab("logins").className).toContain("bg-ink/[0.08]");
    expect([...host.querySelectorAll("button")].some((candidate) => candidate.textContent === "Add login")).toBe(false);
    expect(host.innerHTML).not.toContain("fake-leaked-pass");
  });
});
