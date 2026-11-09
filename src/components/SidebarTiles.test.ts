import { Children, createElement, isValidElement, type KeyboardEvent, type MemoExoticComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setPinnedCircleOrder } from "@/lib/sidebar-preferences";
import { initialState, type Bot } from "@/state/store";

vi.mock("@/lib/interface-mode", async (original) => ({
  ...await original<typeof import("@/lib/interface-mode")>(),
  useAdvancedMode: () => false,
}));
vi.mock("./DesktopCapabilities", () => ({ useDesktopCapabilities: () => ({}) }));

import { botRowProps } from "./Sidebar";
import { SidebarBotTile, SidebarTileGrid } from "./SidebarTiles";

const bot = (extra: Partial<Bot> = {}): Bot => ({
  id: "openbot", threadId: "t", name: "OpenBot", title: "", description: "", notifications: true, color: "chrome",
  unread: false, modelSelection: { instanceId: "fake", model: "m" }, messages: [], ...extra,
});
const dispatch = vi.fn();
const onMenu = vi.fn();
const props = (candidate: Bot, selected = false) => botRowProps({ ...initialState, bots: [candidate], selectedId: selected ? candidate.id : "", activeView: "chat" }, dispatch, candidate, { density: "comfortable", query: "", onMenu });
const tile = (SidebarBotTile as MemoExoticComponent<(props: Parameters<typeof SidebarBotTile>[0]) => ReactNode>).type;

type Props = { children?: ReactNode; [key: string]: unknown };
function find(tree: ReactNode, attribute: string): ReactElement<Props> | undefined {
  for (const child of Children.toArray(tree)) {
    if (!isValidElement<Props>(child)) continue;
    if (child.props[attribute] !== undefined) return child;
    const found = find(child.props.children, attribute);
    if (found) return found;
  }
}

beforeEach(() => {
  dispatch.mockClear();
  onMenu.mockClear();
  vi.stubGlobal("window", { innerWidth: 1280, innerHeight: 800 });
  vi.stubGlobal("HTMLInputElement", class {});
});
afterEach(() => vi.unstubAllGlobals());

describe("the sidebar tiles", () => {
  it("draws the open bot as the 94 by 92 hero card, a 72px avatar over its name inside", () => {
    const html = renderToStaticMarkup(createElement(SidebarBotTile, { ...props(bot({ chiefOfStaff: true })), primary: true }));
    expect(html).toMatch(/data-sidebar-tile="primary"[^>]*class="[^"]*\bh-\[92px\] w-\[94px\][^"]*\brounded-\[14px\]/);
    expect(html).toContain('width="72px" height="72px"');
    expect(html).toMatch(/truncate text-center text-\[13px\] font-medium leading-4 text-ink"[^>]*>OpenBot</);
    expect(html).not.toContain("data-provider-mark");
  });

  it("keeps a pinned bot as the smaller 78 by 92 tile with its name below", () => {
    const html = renderToStaticMarkup(createElement(SidebarBotTile, props(bot())));
    expect(html).toMatch(/data-sidebar-tile="pinned"[^>]*class="[^"]*\bh-\[92px\] w-\[78px\][^"]*\brounded-\[10px\]/);
    expect(html).toContain('width="56px" height="56px"');
    expect(html).not.toContain('width="72px"');
  });

  it("gives the hero card the star badge, and pinned tiles none", () => {
    const tileHtml = (extra: Partial<Bot>, primary: boolean) => renderToStaticMarkup(createElement(SidebarBotTile, { ...props(bot(extra)), primary }));
    const main = tileHtml({ chiefOfStaff: true }, true);
    expect(main).toContain('data-testid="main-badge"');
    expect(main).not.toContain('data-testid="chief-badge"');
    expect(main).toContain('title="OpenBot · Chief of Staff"');
    expect(tileHtml({ defaultBot: {} }, true)).toContain('data-testid="main-badge"');
    expect(tileHtml({}, true)).toContain('data-testid="main-badge"');
    expect(tileHtml({ chiefOfStaff: true }, false)).not.toContain('data-testid="main-badge"');
  });

  it("fills the selected tile and marks it current, and shows working, waiting and unread as a dot on the avatar", () => {
    const selected = renderToStaticMarkup(createElement(SidebarBotTile, { ...props(bot(), true), primary: true }));
    expect(selected).toContain('aria-current="page"');
    expect(selected).toContain("[--tile:var(--color-raised)]");
    expect(renderToStaticMarkup(createElement(SidebarBotTile, props(bot({ busy: true }))))).toContain('data-testid="working-dot"');
    expect(renderToStaticMarkup(createElement(SidebarBotTile, props(bot({ activity: "waiting-on-you" }))))).toContain('data-testid="waiting-dot"');
    const unread = renderToStaticMarkup(createElement(SidebarBotTile, props(bot({ unread: true }))));
    expect(unread).toContain('data-testid="unread-dot"');
    expect(unread).toContain('aria-label="OpenBot · Unread"');
  });

  it("opens the bot on Enter and its menu from the ContextMenu key", () => {
    let tree: ReactNode;
    function Capture() { tree = tile({ ...props(bot()), primary: true }); return tree; }
    renderToStaticMarkup(createElement(Capture));
    const element = find(tree, "data-sidebar-tile")!;
    const key = (name: string) => (element.props.onKeyDown as (event: KeyboardEvent) => void)({
      key: name, shiftKey: false, preventDefault: vi.fn(), currentTarget: { getBoundingClientRect: () => ({ left: 10, top: 20, width: 94, height: 92 }) },
    } as unknown as KeyboardEvent);
    key("Enter");
    expect(dispatch).toHaveBeenCalledWith({ type: "select", id: "openbot" });
    key("ContextMenu");
    expect(onMenu).toHaveBeenCalledWith({ botId: "openbot", x: 57, y: 66 });
  });
});

describe("a tile with a dot", () => {
  it("lands on the thread the dot is about: a tile has no row under it to reach it from", () => {
    const withWork = bot({ threadId: "main", mainThreadId: "main", unread: true, tasks: [{ threadId: "main", title: "Main", createdAt: 1 }, { threadId: "work", title: "@Scout · work", createdAt: 2, unread: true }] });
    let tree: ReactNode;
    function Capture() { tree = tile({ ...props(withWork), primary: true }); return tree; }
    renderToStaticMarkup(createElement(Capture));
    (find(tree, "data-sidebar-tile")!.props.onKeyDown as (event: KeyboardEvent) => void)({ key: "Enter", preventDefault: vi.fn() } as unknown as KeyboardEvent);
    expect(dispatch).toHaveBeenCalledWith({ type: "switchTask", botId: "openbot", threadId: "work" });
  });
});

describe("the tile grid", () => {
  const main = bot({ chiefOfStaff: true });
  const pins = (count: number) => Array.from({ length: count }, (_, index) => bot({ id: `pin${index}`, name: `Pin ${index}`, pinned: true }));
  const grid = (primary: Bot | null, pinned: Bot[]) => {
    const bots = [...(primary ? [primary] : []), ...pinned];
    const row = (candidate: Bot) => botRowProps({ ...initialState, bots, selectedId: "", activeView: "chat" }, dispatch, candidate, { density: "comfortable", query: "", onMenu });
    return renderToStaticMarkup(createElement(SidebarTileGrid, { primary, pinned, row }));
  };
  const tiles = (html: string) => [...html.matchAll(/data-sidebar-bot-row="([^"]+)" data-sidebar-tile="([^"]+)" draggable="(true|false)"/g)]
    .map(([, id, kind, draggable]) => `${kind}:${id}${draggable === "true" ? ":drag" : ""}`);

  afterEach(() => setPinnedCircleOrder([]));

  it.each([0, 1, 2, 3, 5])("puts the main bot first as the hero card, then %i pinned bots in one centred, wrapping grid", (count) => {
    const html = grid(main, pins(count));
    const drag = count > 1 ? ":drag" : "";
    expect(tiles(html)).toEqual(["primary:openbot", ...pins(count).map((pin) => `pinned:${pin.id}${drag}`)]);
    expect(html).toMatch(/^<div data-sidebar-tiles="" class="flex max-h-\[40vh\] flex-wrap justify-center gap-1 overflow-y-auto /);
    expect(html.match(/\bh-\[92px\] w-\[94px\]/g)).toHaveLength(1);
    expect(html.match(/\bh-\[92px\] w-\[78px\]/g) ?? []).toHaveLength(count);
    expect(html.match(/width="72px" height="72px"/g)).toHaveLength(1);
    expect(html.match(/width="56px" height="56px"/g) ?? []).toHaveLength(count);
    expect(html.match(/data-testid="main-badge"/g)).toHaveLength(1);
    expect(html).not.toContain('data-testid="chief-badge"');
  });

  it("follows the saved pinned order after the main bot, which never moves", () => {
    setPinnedCircleOrder(["pin2", "pin0", "openbot"]);
    expect(tiles(grid(main, pins(3)))).toEqual(["primary:openbot", "pinned:pin2:drag", "pinned:pin0:drag", "pinned:pin1:drag"]);
  });

  it("shows the pinned tiles alone when there is no main bot, and nothing when there is neither", () => {
    expect(tiles(grid(null, pins(2)))).toEqual(["pinned:pin0:drag", "pinned:pin1:drag"]);
    expect(grid(null, [])).toBe("");
  });

  // A grid taller than its 40vh cap scrolls, and its 8px scrollbar takes from the room.
  it.each([[280, 3], [360, 4]])("fits %ipx of sidebar to %i pinned tiles across, with or without a scrollbar", (width, columns) => {
    const html = grid(null, pins(5));
    const tile = Number(/data-sidebar-tile="pinned"[^>]*class="[^"]*\bw-\[(\d+)px\]/.exec(html)![1]);
    const gridClass = /data-sidebar-tiles="" class="([^"]*)"/.exec(html)![1]!;
    const gap = 4 * Number(/\bgap-(\d+)\b/.exec(gridClass)![1]);
    const gutters = 2 * 4 * Number(/\bpx-(\d+)\b/.exec(gridClass)![1]);
    const across = (room: number) => Math.floor((room + gap) / (tile + gap));
    expect(across(width - gutters)).toBe(columns);
    expect(across(width - gutters - 8)).toBe(columns);
  });
});
