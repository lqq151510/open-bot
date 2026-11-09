// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const clock = vi.hoisted(() => ({ frame: null as null | ((now: number) => number) }));
vi.mock("./mascot-clock", () => ({
  usePrefersReducedMotion: () => false,
  mascotClock: () => ({ add: (frame: (now: number) => number) => { clock.frame = frame; return { wake() {}, remove() { clock.frame = null; } }; } }),
}));
import { MausAvatar } from "./Avatar";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let cleanup: (() => void) | undefined;
afterEach(() => { cleanup?.(); cleanup = undefined; });

it("moves the rendered eyes towards the pointer and returns them after leaving", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(createElement(MausAvatar, { color: "green", bodyId: "circle", animated: false })));
  cleanup = () => { act(() => root.unmount()); container.remove(); };
  const target = container.querySelector("span")!;
  target.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
  const eye = container.querySelector('path[fill="#ffffff"]')!;
  act(() => { clock.frame!(1000); });
  const initial = eye.getAttribute("transform");
  act(() => { target.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerType: "mouse", clientX: 95, clientY: 50 })); });
  act(() => { clock.frame!(1017); });
  const looking = eye.getAttribute("transform");
  expect(looking).not.toBe(initial);
  act(() => { target.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, pointerType: "mouse" })); });
  act(() => { clock.frame!(1034); });
  expect(eye.getAttribute("transform")).toBe(initial);
});
