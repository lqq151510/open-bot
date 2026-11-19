import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type RefObject } from "react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import {
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_WIDTH_KEY,
  SIMPLE_SIDEBAR_MAX_WIDTH,
  SIMPLE_SIDEBAR_WIDTH_KEY,
  clampSidebarWidth,
  loadSidebarWidth,
  saveSidebarWidth,
} from "@/lib/sidebar-preferences";

export function sidebarDefaultWidth(simple: boolean, viewportWidth = 1280): number {
  return simple && viewportWidth >= 1536 ? Math.round(viewportWidth * 0.269) : simple ? 280 : 320;
}

/** Narrower than this, the sidebar's dragged edge leaves its column of avatars; wider again, the sidebar opens. */
export const AVATARS_BELOW = 160;

/** Where a drag of the sidebar's edge has it: its column of avatars, or open; open, at the width it had until the
 * pointer reaches that edge (`following` false), then wherever the pointer is. */
export interface EdgeDrag { avatars: boolean; following: boolean }

/** The drag after the pointer moved to `wanted` pixels from the sidebar's left; `from` is the width it opens at. */
export function nextEdgeDrag(drag: EdgeDrag, wanted: number, from: number): EdgeDrag {
  if (wanted < AVATARS_BELOW) return { avatars: true, following: false };
  if (drag.avatars) return { avatars: false, following: false };
  return { avatars: false, following: drag.following || wanted >= from };
}

const viewportWidthSnapshot = () => typeof window === "undefined" ? 1280 : window.innerWidth;

function subscribeViewportWidth(onChange: () => void) {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

export type SidebarSizing = ReturnType<typeof useSidebarWidth>;

export function useSidebarWidth({ simple, sidePanelOpen, sidebarRef }: {
  simple: boolean;
  sidePanelOpen: boolean;
  sidebarRef: RefObject<HTMLElement | null>;
}) {
  const key = simple ? SIMPLE_SIDEBAR_WIDTH_KEY : SIDEBAR_WIDTH_KEY;
  const viewportWidth = useSyncExternalStore(subscribeViewportWidth, viewportWidthSnapshot, viewportWidthSnapshot);
  const defaultWidth = sidebarDefaultWidth(simple, viewportWidth);
  const cap = simple ? (viewportWidth >= 1536 ? SIMPLE_SIDEBAR_MAX_WIDTH : 400) : SIDEBAR_MAX_WIDTH;
  const resizeViewport = sidePanelOpen ? defaultWidth + 320 : viewportWidth;
  const maxWidth = clampSidebarWidth(cap, resizeViewport, cap);
  const [savedWidth, setSavedWidth] = useState<number | null>(() => loadSidebarWidth(undefined, key));
  const widthRef = useRef(savedWidth);
  const [resizing, setResizing] = useState(false);
  const [snapping, setSnapping] = useState(false);
  const snapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const width = loadSidebarWidth(undefined, key);
    widthRef.current = width;
    setSavedWidth(width);
  }, [key]);
  useEffect(() => () => { if (snapTimer.current) clearTimeout(snapTimer.current); }, []);
  const current = () => Math.min(widthRef.current ?? defaultWidth, maxWidth);
  const resizeTo = (width: number) => {
    const next = clampSidebarWidth(width, resizeViewport, cap);
    if (next === Math.round(sidebarRef.current?.getBoundingClientRect().width ?? defaultWidth)) return null;
    widthRef.current = next;
    sidebarRef.current?.style.setProperty("--sidebar-width", `${next}px`);
    return next;
  };
  const save = (width: number) => {
    setSavedWidth(width);
    saveSidebarWidth(width, undefined, key);
  };
  const resizeAndSave = (width: number) => {
    const next = resizeTo(width);
    if (next !== null) save(next);
  };
  return {
    width: Math.min(widthRef.current ?? defaultWidth, sidePanelOpen ? maxWidth : cap),
    defaultWidth,
    maxWidth,
    resizing,
    /** A drag just took the sidebar to its avatars or back: its width animates, mid-drag too. */
    snapping,
    valueNow: Math.min(savedWidth ?? defaultWidth, maxWidth),
    atMinimum: () => current() <= SIDEBAR_MIN_WIDTH,
    /** A drag begins: the width the sidebar has now. */
    startResize: () => { setResizing(true); return current(); },
    resizeTo,
    /** Back to `width`, unsaved: the drag ends where the sidebar was. */
    restore: (width: number) => {
      widthRef.current = width;
      sidebarRef.current?.style.setProperty("--sidebar-width", `${width}px`);
    },
    snap: () => {
      if (snapTimer.current) clearTimeout(snapTimer.current);
      setSnapping(true);
      snapTimer.current = setTimeout(() => setSnapping(false), 220);
    },
    /** The drag ends, and the width it left is kept. */
    finishResize: () => {
      setResizing(false);
      if (widthRef.current !== null) save(widthRef.current);
    },
    stepResize: (step: number) => resizeAndSave(current() + step),
    maximize: () => { if (current() < maxWidth) resizeAndSave(maxWidth); },
  };
}

/** While the edge is dragged the whole page shows the resize cursor and selects no text, wherever the pointer is. */
function holdPageCursor(held: boolean) {
  document.body.style.cursor = held ? "col-resize" : "";
  document.body.style.userSelect = held ? "none" : "";
}

/** The sidebar's edge: a 12px strip centred on the sidebar's hairline that draws nothing of its own. Dragged, it resizes the sidebar, and past AVATARS_BELOW it leaves the column of avatars or opens
 * the sidebar again at its last width. The arrow keys do the same, a step at a time. */
export function SidebarResizeHandle({ sizing, sidebarRef, avatars, avatarsWidth, onAvatars, style }: {
  sizing: SidebarSizing;
  sidebarRef: RefObject<HTMLElement | null>;
  avatars: boolean;
  avatarsWidth: number;
  onAvatars: (avatars: boolean) => void;
  style?: CSSProperties;
}) {
  const drag = useRef<{ state: EdgeDrag; from: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  useEffect(() => () => holdPageCursor(false), []);
  const end = () => {
    const ended = drag.current;
    drag.current = null;
    setDragging(false);
    holdPageCursor(false);
    if (ended) sizing.finishResize();
  };
  return (
    <div
      role="separator"
      aria-label={t("sidebar.resize")}
      aria-orientation="vertical"
      aria-valuemin={avatarsWidth}
      aria-valuemax={sizing.maxWidth}
      aria-valuenow={avatars ? avatarsWidth : sizing.valueNow}
      tabIndex={0}
      data-sidebar-resize={dragging ? "dragging" : ""}
      className={cn("absolute inset-y-0 -right-1.5 z-20 hidden w-3 cursor-col-resize touch-none outline-none md:block",
        "after:absolute after:inset-y-0 after:left-[5px] after:w-0.5 focus-visible:after:bg-focus")}
      style={style}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { state: { avatars, following: !avatars }, from: sizing.startResize() };
        setDragging(true);
        holdPageCursor(true);
      }}
      onPointerMove={(event) => {
        const current = drag.current;
        if (!current || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const wanted = event.clientX - (sidebarRef.current?.getBoundingClientRect().left ?? 0);
        const next = nextEdgeDrag(current.state, wanted, current.from);
        if (next.avatars !== current.state.avatars) {
          sizing.snap();
          if (next.avatars) sizing.restore(current.from);
          onAvatars(next.avatars);
        }
        current.state = next;
        const width = next.following ? sizing.resizeTo(wanted) : null;
        if (width !== null) event.currentTarget.setAttribute("aria-valuenow", String(width));
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={(event) => {
        switch (event.key) {
          case "Home":
            if (!avatars) onAvatars(true);
            break;
          case "End":
            sizing.maximize();
            if (avatars) onAvatars(false);
            break;
          case "ArrowLeft":
            if (avatars) break;
            if (sizing.atMinimum()) onAvatars(true);
            else sizing.stepResize(-16);
            break;
          case "ArrowRight":
            if (avatars) onAvatars(false);
            else sizing.stepResize(16);
            break;
          default:
            return;
        }
        event.preventDefault();
      }}
    />
  );
}
