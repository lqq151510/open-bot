// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { t } from "@/lib/i18n";
import type { UpdaterState } from "@/lib/updater";
import { UpdatesRow } from "./AppSettingsRows";

let host: HTMLDivElement;
let root: Root;
let push: (state: UpdaterState) => void;
const setAutoUpdateWhenIdle = vi.fn<(on: boolean) => Promise<void>>();
const updateSwitch = () => host.querySelector<HTMLButtonElement>('[role="switch"]');

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  setAutoUpdateWhenIdle.mockReset();
  vi.stubGlobal("ogb", {
    updater: {
      check: vi.fn(),
      install: vi.fn(),
      setAutoUpdateWhenIdle,
      onState: (callback: (state: UpdaterState) => void) => {
        push = callback;
        callback({ status: "idle" });
        return () => {};
      },
    },
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("uses the desktop's saved choice and reports failures without moving the switch", async () => {
  await act(async () => root.render(createElement(UpdatesRow)));
  expect(updateSwitch()).toBeNull();
  expect(host.textContent).toContain(t("settings.updates.check"));

  await act(async () => push({ status: "idle", autoUpdateWhenIdle: false }));
  expect(updateSwitch()?.getAttribute("aria-checked")).toBe("false");
  setAutoUpdateWhenIdle.mockRejectedValueOnce(new Error("read only"));
  await act(async () => updateSwitch()?.click());
  expect(setAutoUpdateWhenIdle).toHaveBeenLastCalledWith(true);
  expect(host.querySelector('[role="alert"]')?.textContent).toBe(t("settings.updates.autoUpdateSaveFailed"));
  expect(updateSwitch()?.getAttribute("aria-checked")).toBe("false");

  const pending = Promise.withResolvers<void>();
  setAutoUpdateWhenIdle.mockReturnValueOnce(pending.promise);
  await act(async () => updateSwitch()?.click());
  expect(updateSwitch()?.disabled).toBe(true);
  expect(updateSwitch()?.getAttribute("aria-checked")).toBe("false");
  await act(async () => {
    push({ status: "idle", autoUpdateWhenIdle: true });
    pending.resolve();
  });
  expect(updateSwitch()?.getAttribute("aria-checked")).toBe("true");
  expect(updateSwitch()?.disabled).toBe(false);
  expect(host.querySelector('[role="alert"]')).toBeNull();
});
