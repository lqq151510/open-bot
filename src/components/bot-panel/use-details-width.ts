import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from "react";

const WIDTH_KEY = "openbot.botDetailsWidth";
const MIN_WIDTH = 260;
const MAX_WIDTH = 566;
const CHAT_WIDTH = 320;

function readWidth(): number | null {
  try {
    const width = Number(localStorage.getItem(WIDTH_KEY));
    return width >= MIN_WIDTH && width <= MAX_WIDTH ? width : null;
  } catch {
    return null;
  }
}

export function useDetailsWidth(panelRef: RefObject<HTMLElement | null>, enabled: boolean) {
  const [preferredWidth, setPreferredWidth] = useState(readWidth);
  const [layout, setLayout] = useState<{ width: number; max: number } | null>(null);
  const drag = useRef<{ pointer: number; x: number; start: number; width: number; preferred: number | null; direction: number } | null>(null);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const chat = panel?.parentElement?.querySelector<HTMLElement>(":scope > [data-chat-column]");
    if (!enabled || !panel || !chat) {
      setLayout(null);
      return;
    }
    const measure = () => {
      const width = panel.offsetWidth;
      const max = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width + chat.offsetWidth - CHAT_WIDTH));
      setLayout(current => current?.width === width && current.max === max ? current : { width, max });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(chat);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [enabled, panelRef]);

  const max = layout?.max ?? MAX_WIDTH;
  const style = enabled ? { width: preferredWidth ?? undefined, maxWidth: layout?.max } : undefined;
  const clamp = (next: number) => Math.round(Math.min(max, Math.max(MIN_WIDTH, next)));
  const save = (next: number) => {
    setPreferredWidth(next);
    try {
      localStorage.setItem(WIDTH_KEY, String(next));
    } catch {
    }
  };
  const handle = enabled && layout ? {
    "aria-valuemin": MIN_WIDTH,
    "aria-valuemax": max,
    "aria-valuenow": layout.width,
    onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const direction = getComputedStyle(event.currentTarget).direction === "rtl" ? -1 : 1;
      const next = event.key === "ArrowLeft" ? layout.width + 20 * direction
        : event.key === "ArrowRight" ? layout.width - 20 * direction
        : event.key === "Home" ? MIN_WIDTH
        : event.key === "End" ? max : null;
      if (next === null) return;
      event.preventDefault();
      save(clamp(next));
    },
    onPointerDown(event: PointerEvent<HTMLDivElement>) {
      if (event.button !== 0) return;
      event.currentTarget.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = {
        pointer: event.pointerId, x: event.clientX, start: layout.width, width: layout.width, preferred: preferredWidth,
        direction: getComputedStyle(event.currentTarget).direction === "rtl" ? -1 : 1,
      };
    },
    onPointerMove(event: PointerEvent<HTMLDivElement>) {
      const current = drag.current;
      if (current?.pointer !== event.pointerId) return;
      current.width = clamp(current.start + (current.x - event.clientX) * current.direction);
      setPreferredWidth(current.width);
    },
    onPointerUp(event: PointerEvent<HTMLDivElement>) {
      const current = drag.current;
      if (current?.pointer !== event.pointerId) return;
      drag.current = null;
      if (current.width !== current.start) save(clamp(current.width));
      else setPreferredWidth(current.preferred);
    },
    onLostPointerCapture(event: PointerEvent<HTMLDivElement>) {
      if (drag.current?.pointer !== event.pointerId) return;
      setPreferredWidth(drag.current.preferred);
      drag.current = null;
    },
  } : null;

  return { style, handle };
}
