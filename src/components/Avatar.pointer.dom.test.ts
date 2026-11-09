// @vitest-environment happy-dom
import { act, createElement, forwardRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const clock = vi.hoisted(() => ({ add: vi.fn(() => ({ remove: vi.fn() })), reduced: false }));
vi.mock("./mascot-clock", () => ({ mascotClock: () => ({ add: clock.add }), usePrefersReducedMotion: () => clock.reduced }));
vi.mock("./CursorAvatar", async (original) => ({
  ...await original<typeof import("./CursorAvatar")>(),
  CursorAvatar: forwardRef(function CursorProbe(props: { gaze?: { x?: number; y?: number }; paused?: boolean }, _ref) {
    return createElement("i", { "data-gaze-x": props.gaze?.x, "data-gaze-y": props.gaze?.y, "data-paused": String(props.paused) });
  }),
}));
import { MausAvatar } from "./Avatar";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("mascot pointer tracking", () => {
  let cleanup: (() => void) | undefined;
  afterEach(() => { cleanup?.(); cleanup = undefined; clock.add.mockClear(); clock.reduced = false; });

  function mount(bodyId: "circle" | "pumpkin", trackPointer = true) {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    act(() => root.render(createElement(MausAvatar, { color: "green", bodyId, animated: false, trackPointer })));
    cleanup = () => { act(() => root.unmount()); container.remove(); };
    const target = container.querySelector("span")!;
    target.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
    return { container, target, root };
  }

  it("wakes an idle mascot on mouse movement and rests again on leave", () => {
    const { container, target } = mount("circle");
    const probe = () => container.querySelector("i")!;
    expect(probe().dataset.paused).toBe("true");
    act(() => target.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerType: "mouse", clientX: 100, clientY: 0 })));
    expect(probe().dataset).toMatchObject({ gazeX: "1", gazeY: "-1", paused: "false" });
    act(() => target.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, pointerType: "mouse" })));
    expect(probe().dataset).toMatchObject({ gazeX: "0", gazeY: "0", paused: "true" });
  });

  it("does not wake when tracking is disabled", () => {
    const { container, target } = mount("circle", false);
    act(() => target.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerType: "mouse", clientX: 90, clientY: 10 })));
    expect(container.querySelector("i")!.dataset.paused).toBe("true");
  });

  it("does not follow touch input", () => {
    const { container, target } = mount("circle");
    act(() => target.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerType: "touch", clientX: 90, clientY: 10 })));
    expect(container.querySelector("i")!.dataset.paused).toBe("true");
  });

  it("does not follow when reduced motion is enabled", () => {
    clock.reduced = true;
    const { container, target } = mount("circle");
    act(() => target.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerType: "mouse", clientX: 90, clientY: 10 })));
    expect(container.querySelector("i")!.dataset.paused).toBe("true");
  });

  it("clears a pending gaze when tracking is turned off", () => {
    const { container, target, root } = mount("circle");
    act(() => target.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerType: "mouse", clientX: 90, clientY: 10 })));
    expect(container.querySelector("i")!.dataset.paused).toBe("false");
    act(() => root.render(createElement(MausAvatar, { color: "green", bodyId: "circle", animated: false, trackPointer: false })));
    expect(container.querySelector("i")!.dataset).toMatchObject({ gazeX: "0", gazeY: "0", paused: "true" });
  });

  it("only runs the special mascot clock while the pointer is over it", () => {
    const { target } = mount("pumpkin");
    expect(clock.add).not.toHaveBeenCalled();
    act(() => target.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerType: "mouse", clientX: 90, clientY: 10 })));
    expect(clock.add).toHaveBeenCalledOnce();
    const ticket = clock.add.mock.results[0]!.value;
    act(() => target.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, pointerType: "mouse" })));
    expect(ticket.remove).toHaveBeenCalledOnce();
  });

  it("does not start an automatic blink for a resting special mascot", () => {
    const { container, target } = mount("pumpkin");
    act(() => target.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerType: "mouse", clientX: 50, clientY: 50 })));
    const frame = (clock.add.mock.calls as unknown as Array<[(now: number) => number]>)[0]![0];
    const now = performance.now() + 10_000;
    const eye = container.querySelector("rect")!;
    act(() => { frame(now); });
    const height = eye.getAttribute("height");
    act(() => { frame(now + 90); });
    expect(eye.getAttribute("height")).toBe(height);
  });
});
