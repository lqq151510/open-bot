import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Window as DomWindow } from "happy-dom";
import nativeText from "./native-text.cjs";
import { createDesktopPrefs } from "./desktop-prefs.mjs";
import { createTalkServer } from "./talk-server.mjs";
import { installTalk, isTalkPanel } from "./talk-main.mjs";
import { createSystemTray } from "./system-tray.mjs";
import {
  SPOTLIGHT_PANEL,
  SPOTLIGHT_SHORTCUTS,
  createSpotlight,
  createSpotlightShortcut,
  isSpotlightPanel,
  spotlightBounds,
  spotlightHtml,
} from "./spotlight.mjs";

const APP_ICON = fileURLToPath(new URL("./resources/app-icon.png", import.meta.url));
const settle = async () => { for (let i = 0; i < 12; i += 1) await new Promise(resolve => setImmediate(resolve)); };
const painted = win => JSON.parse(win.webContents.scripts.filter(s => s.startsWith("render(")).at(-1).slice(7, -1));

function fakeShortcuts(taken = []) {
  const registered = new Map();
  return {
    registered,
    register: (accelerator, fn) => !taken.includes(accelerator) && Boolean(registered.set(accelerator, fn)),
    unregister: accelerator => { registered.delete(accelerator); },
  };
}

function fakeTrayDeps() {
  const trays = [];
  class Tray extends EventEmitter {
    constructor(icon, guid) { super(); this.icon = icon; this.guid = guid; this.destroyed = false; trays.push(this); }
    setToolTip(value) { this.tip = value; }
    setContextMenu(value) { this.menu = value; }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; }
  }
  return {
    trays,
    Tray,
    Menu: { buildFromTemplate: items => items },
    nativeImage: { createFromPath: () => ({ resize: () => ({}) }) },
    iconPath: APP_ICON,
  };
}

function fakeServerHarness({ bots = [{ id: "m", defaultBot: {}, tasks: [] }], down = false, starting = false } = {}) {
  const encoder = new TextEncoder();
  const state = { calls: [], events: null, down, starting };
  const request = async (route, init = {}) => {
    const method = init.method ?? "GET";
    state.calls.push([method, route, init.body ? JSON.parse(init.body) : undefined]);
    if (state.down) throw new TypeError("fetch failed");
    if (method === "GET" && route === "/api/bots?messages=0") return Response.json({ bots });
    if (method === "POST" && route === "/api/bots/m/tasks") return Response.json({ task: { threadId: "t-qa", title: "Quick asks" } }, { status: 201 });
    if (method === "GET" && route === "/api/events?screens=off") {
      let controller;
      const body = new ReadableStream({ start(c) { controller = c; }, cancel() { state.events.cancelled = true; } });
      state.events = {
        cancelled: false,
        push: frame => controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`)),
        end: () => controller.close(),
      };
      return new Response(body, { headers: { "content-type": "text/event-stream" } });
    }
    if (method === "POST" && route === "/api/bots/m/messages") return Response.json({ ok: true }, { status: 202 });
    return new Response(null, { status: 404 });
  };
  const prefs = createDesktopPrefs({ read: () => null, write: () => {} });
  const server = createTalkServer({ request, prefs, serverKey: () => "local", starting: () => state.starting });
  return { state, server, prefs };
}

function spotlightHarness(serverOpts = {}) {
  const windows = [];
  const opened = [];
  const logs = [];
  const srv = fakeServerHarness(serverOpts);
  class FakeBrowserWindow {
    constructor(options) {
      Object.assign(this, { options, url: "", bounds: { x: options.x, y: options.y, width: options.width, height: options.height },
        visible: false, focused: false, destroyed: false, openHandler: null, calls: [] });
      this.events = new EventEmitter();
      this.webContents = Object.assign(new EventEmitter(), {
        scripts: [],
        executeJavaScript: async script => { this.webContents.scripts.push(script); return 120; },
        setWindowOpenHandler: handler => { this.openHandler = handler; },
      });
      windows.push(this);
    }
    on(...args) { this.events.on(...args); }
    setAlwaysOnTop(...args) { this.calls.push(["setAlwaysOnTop", ...args]); }
    setVisibleOnAllWorkspaces(...args) { this.calls.push(["setVisibleOnAllWorkspaces", ...args]); }
    setBounds(bounds) { this.bounds = bounds; this.calls.push(["setBounds", bounds]); }
    getBounds() { return this.bounds; }
    show() { this.visible = true; this.calls.push(["show"]); }
    hide() { this.visible = false; this.focused = false; this.calls.push(["hide"]); }
    focus() { this.focused = true; this.calls.push(["focus"]); }
    isFocused() { return this.focused; }
    loadURL(url) { this.url = url; return Promise.resolve(); }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; }
  }
  const nativeImage = { createFromPath: () => ({ isEmpty: () => false, resize: () => ({ toPNG: () => Buffer.from("png") }) }) };
  const area = { x: 0, y: 25, width: 1440, height: 875 };
  const screen = { getCursorScreenPoint: () => ({ x: 200, y: 200 }), getDisplayNearestPoint: () => ({ workArea: area }) };
  const spotlight = createSpotlight({
    BrowserWindow: FakeBrowserWindow, screen, nativeImage, iconPath: APP_ICON,
    server: srv.server, openChat: chat => opened.push(chat), log: line => logs.push(line),
    newSendId: () => "send-1",
  });
  return { spotlight, windows, opened, logs, srv };
}

test("createSpotlightShortcut registers Alt+Space and falls back to CommandOrControl+Shift+Space", () => {
  const s1 = fakeShortcuts();
  let toggles = 0;
  const sc1 = createSpotlightShortcut({ globalShortcut: s1, available: () => true, onToggle: () => { toggles += 1; } });
  assert.deepEqual(SPOTLIGHT_SHORTCUTS, ["Alt+Space", "CommandOrControl+Shift+Space"]);
  assert.equal(sc1.accelerator(), "Alt+Space");
  s1.registered.get("Alt+Space")();
  assert.equal(toggles, 1);
  sc1.close();
  assert.equal(sc1.accelerator(), null);
  assert.deepEqual([...s1.registered.keys()], []);

  const s2 = fakeShortcuts(["Alt+Space"]);
  let avail = true;
  const sc2 = createSpotlightShortcut({ globalShortcut: s2, available: () => avail, onToggle: () => {} });
  assert.equal(sc2.accelerator(), "CommandOrControl+Shift+Space");
  avail = false;
  sc2.refresh();
  assert.equal(sc2.accelerator(), null);
  assert.deepEqual([...s2.registered.keys()], []);
  avail = true;
  sc2.refresh();
  assert.equal(sc2.accelerator(), "CommandOrControl+Shift+Space");

  const s3 = fakeShortcuts(["Alt+Space", "CommandOrControl+Shift+Space"]);
  const sc3 = createSpotlightShortcut({ globalShortcut: s3, available: () => true, onToggle: () => {} });
  assert.equal(sc3.accelerator(), null);
});

test("spotlight-preload.cjs exposes only the whitelisted window.spotlight IPC methods", () => {
  const require = createRequire(import.meta.url);
  const sent = [];
  const exposed = new Map();
  const electronEntry = require.resolve("electron");
  const prev = require.cache[electronEntry];
  require.cache[electronEntry] = {
    id: electronEntry, filename: electronEntry, loaded: true,
    exports: {
      contextBridge: { exposeInMainWorld: (name, api) => exposed.set(name, api) },
      ipcRenderer: { send: (channel, ...args) => sent.push([channel, ...args]) },
    },
  };
  try {
    delete require.cache[require.resolve("./spotlight-preload.cjs")];
    require("./spotlight-preload.cjs");
  } finally {
    if (prev) require.cache[electronEntry] = prev;
    else delete require.cache[electronEntry];
  }
  assert.deepEqual([...exposed.keys()], ["spotlight"]);
  const api = exposed.get("spotlight");
  assert.deepEqual(Object.keys(api).sort(), ["dismiss", "openChat", "resize", "stop", "submit"]);
  api.submit("a".repeat(4500));
  api.submit(null);
  api.stop();
  api.openChat();
  api.dismiss();
  api.resize("180");
  assert.deepEqual(sent, [
    ["spotlight:submit", "a".repeat(4000)],
    ["spotlight:submit", ""],
    ["spotlight:stop"],
    ["spotlight:open-chat"],
    ["spotlight:dismiss"],
    ["spotlight:resize", 180],
  ]);
});

test("spotlightBounds centers horizontally and places panel ~18% from workArea top", () => {
  assert.deepEqual(SPOTLIGHT_PANEL, { width: 560, minHeight: 64, maxHeight: 360, topRatio: 0.18 });
  assert.deepEqual(spotlightBounds({ x: 0, y: 25, width: 1440, height: 875 }, 64), { x: 440, y: 183, width: 560, height: 64 });
  assert.deepEqual(spotlightBounds({ x: 1440, y: 0, width: 1920, height: 1050 }, 999), { x: 2120, y: 189, width: 560, height: 360 });
  assert.equal(spotlightBounds({ x: 0, y: 0, width: 800, height: 600 }, 10).height, 64);
});

test("spotlight window enforces security invariants, streams replies, guards blur while busy, and opens chat", async () => {
  const { spotlight, windows, opened, srv } = spotlightHarness();
  spotlight.toggle();
  const win = windows[0];
  assert.equal(isSpotlightPanel(win), true);
  assert.equal(isTalkPanel(win), true);
  assert.deepEqual(
    { contextIsolation: win.options.webPreferences.contextIsolation, sandbox: win.options.webPreferences.sandbox,
      nodeIntegration: win.options.webPreferences.nodeIntegration, alwaysOnTop: win.options.alwaysOnTop,
      frame: win.options.frame, transparent: win.options.transparent },
    { contextIsolation: true, sandbox: true, nodeIntegration: false, alwaysOnTop: true, frame: false, transparent: true },
  );
  assert.ok(win.options.webPreferences.preload.endsWith("spotlight-preload.cjs"));
  assert.deepEqual(win.openHandler(), { action: "deny" });
  const nav = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  win.webContents.emit("will-navigate", nav);
  assert.equal(nav.defaultPrevented, true);

  const html = spotlightHtml("AAAA");
  assert.match(html, /default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'/);
  assert.match(html, /textContent/);
  assert.doesNotMatch(html, /innerHTML|insertAdjacentHTML|outerHTML|https?:\/\//);

  win.webContents.emit("did-finish-load");
  await settle();
  assert.equal(win.visible, true);
  assert.equal(win.focused, true);
  assert.equal(painted(win).state, "idle");

  win.webContents.emit("ipc-message", {}, "spotlight:submit", "Check calendar");
  await settle();
  assert.equal(spotlight.busy(), true);
  assert.equal(painted(win).state, "sending");

  // Blur during active streaming must NOT hide the panel.
  win.events.emit("blur");
  assert.equal(win.visible, true);

  srv.state.events.push({ kind: "hello", cursor: "1", resumed: false });
  await settle();
  for (const frame of [
    { kind: "message", threadId: "t-qa", message: { id: "u1", role: "user", kind: "text", text: "Check calendar", sendId: "send-1" } },
    { kind: "runtime", event: { type: "content.delta", streamKind: "assistant_text", threadId: "t-qa", itemId: "i1", delta: "Line 1\nLine 2" } },
  ]) srv.state.events.push(frame);
  await settle();
  assert.equal(painted(win).state, "streaming");
  assert.equal(painted(win).text, "Line 1\nLine 2");

  srv.state.events.push({ kind: "runtime", event: { type: "turn.completed", threadId: "t-qa", ok: true } });
  await settle();
  assert.equal(spotlight.busy(), false);
  assert.equal(painted(win).state, "done");

  win.webContents.emit("ipc-message", {}, "spotlight:resize", 220);
  assert.equal(win.bounds.height, 220);

  win.webContents.emit("ipc-message", {}, "spotlight:open-chat");
  assert.deepEqual(opened, [{ botId: "m", threadId: "t-qa" }]);
  assert.equal(win.visible, false);

  // Reopen idle and verify blur auto-hides when idle.
  spotlight.toggle();
  await settle();
  assert.equal(win.visible, true);
  assert.equal(painted(win).state, "idle");
  win.events.emit("blur");
  assert.equal(win.visible, false);

  spotlight.close();
  assert.equal(win.destroyed, true);
});

test("spotlight stop cancels streaming and preserves partial answer; starting error renders message", async () => {
  const { spotlight, windows, srv } = spotlightHarness();
  spotlight.toggle();
  const win = windows[0];
  win.webContents.emit("did-finish-load");
  await settle();

  win.webContents.emit("ipc-message", {}, "spotlight:submit", "Hi");
  await settle();
  srv.state.events.push({ kind: "hello", cursor: "1", resumed: false });
  await settle();
  srv.state.events.push({ kind: "message", threadId: "t-qa", message: { id: "u1", role: "user", kind: "text", text: "Hi", sendId: "send-1" } });
  srv.state.events.push({ kind: "runtime", event: { type: "content.delta", streamKind: "assistant_text", threadId: "t-qa", itemId: "i1", delta: "Partial" } });
  await settle();
  win.webContents.emit("ipc-message", {}, "spotlight:stop");
  await settle();
  assert.equal(spotlight.busy(), false);
  assert.equal(srv.state.events.cancelled, true);
  assert.equal(painted(win).state, "done");
  assert.equal(painted(win).text, "Partial");
  spotlight.close();

  const down = spotlightHarness({ down: true, starting: true });
  down.spotlight.toggle();
  down.windows[0].webContents.emit("did-finish-load");
  await settle();
  down.windows[0].webContents.emit("ipc-message", {}, "spotlight:submit", "Retry me");
  await settle();
  assert.equal(painted(down.windows[0]).state, "error");
  assert.equal(painted(down.windows[0]).text, "OpenBot is still starting. Try again in a moment.");
  assert.equal(painted(down.windows[0]).restorePrompt, "Retry me");
  down.spotlight.close();
});

test("installTalk exposes Spotlight on non-macOS and shares Quick asks chat", async () => {
  const srv = fakeServerHarness();
  const registered = new Map();
  const windows = [];
  const text = nativeText.createNativeText({ saved: "en" });
  class FakeWin {
    constructor(options) {
      this.options = options; this.destroyed = false; this.events = new EventEmitter();
      this.webContents = Object.assign(new EventEmitter(), { scripts: [], setWindowOpenHandler() {}, executeJavaScript: async s => { this.webContents.scripts.push(s); return 80; } });
      windows.push(this);
    }
    on(...a) { this.events.on(...a); } setAlwaysOnTop() {} setVisibleOnAllWorkspaces() {} setBounds() {}
    show() {} hide() {} focus() {} loadURL() { return Promise.resolve(); }
    isDestroyed() { return this.destroyed; } destroy() { this.destroyed = true; }
  }
  const talk = installTalk({
    ipcMain: { handle() {} }, localOnly: (_c, h) => h, localOrHome: (_c, h) => h,
    BrowserWindow: FakeWin, appleSpeech: false,
    speech: { start() {}, stop() {}, finish() {}, busy: () => false },
    packaged: true, devUrl: "http://127.0.0.1:5199",
    nativeImage: { createFromPath: () => ({ isEmpty: () => false, resize: () => ({ toPNG: () => Buffer.from("png") }) }) },
    iconPath: APP_ICON, openLink() {}, reveal() {}, log() {}, t: text.t,
  });
  const localRequests = [];
  talk.start({
    globalShortcut: { register: (acc, fn) => { registered.set(acc, fn); return true; }, unregister: acc => registered.delete(acc) },
    screen: { getCursorScreenPoint: () => ({ x: 0, y: 0 }), getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 25, width: 1440, height: 875 } }) },
    prefs: srv.prefs, remote: () => false, away: () => false, starting: () => false,
    localRequest: (route) => {
      localRequests.push(route);
      if (route === "/api/bots?messages=0") return Promise.resolve(Response.json({ bots: [{ id: "m", defaultBot: {}, tasks: [] }] }));
      if (route === "/api/bots/m/tasks") return Promise.resolve(Response.json({ task: { threadId: "shared-qa" } }, { status: 201 }));
      return Promise.resolve(new Response(null, { status: 404 }));
    },
    dataDir: () => "/tmp/openbot",
  });
  assert.equal(talk.spotlightAccelerator(), "Alt+Space");
  assert.deepEqual([...registered.keys()], ["Alt+Space"]);
  talk.skin("meadow");
  talk.toggleSpotlight();
  windows[0].webContents.emit("did-finish-load");
  await settle();
  assert.equal(painted(windows[0]).theme, "light");
  windows[0].webContents.emit("ipc-message", {}, "spotlight:submit", "Check shared chat");
  await settle();
  assert.deepEqual(srv.prefs.quickAsksChat("/tmp/openbot"), { botId: "m", threadId: "shared-qa" });
  assert.equal(localRequests.includes("/api/bots/m/tasks"), true);
  talk.relabel();
  await settle();
  assert.equal(painted(windows[0]).labels.send, "Send");
  talk.close();
  assert.equal(talk.spotlightAccelerator(), null);
  assert.deepEqual([...registered.keys()], []);
});

test("createSystemTray preserves legacy mode and upgrades assistant mode for macOS and Windows", () => {
  const deps = fakeTrayDeps();
  const events = [];
  const win = { destroyed: false, minimized: false, isDestroyed: () => false, isMinimized: () => false, show: () => events.push("show"), focus: () => events.push("focus"), setSkipTaskbar: () => {} };

  const legacy = createSystemTray({ ...deps, getWindow: () => win, onQuit: () => events.push("quit"), platform: "win32" });
  assert.equal(deps.trays[0].tip, "OpenBot");
  assert.deepEqual(deps.trays[0].menu.map(i => i.label ?? i.type), ["Open OpenMaus Bot", "separator", "Quit OpenMaus Bot"]);
  deps.trays[0].emit("click");
  assert.deepEqual(events, ["show", "focus"]);
  legacy.destroy();

  events.length = 0;
  let busy = false;
  let accel = "Alt+Space";
  const text = nativeText.createNativeText({ saved: "en" });
  const macTray = createSystemTray({
    ...deps, getWindow: () => win, onQuit: () => events.push("quit"),
    onQuickAsk: () => events.push("quickAsk"), onInterruptLocal: () => events.push("interrupt"),
    isLocalBusy: () => busy, getAccelerator: () => accel, platform: "darwin", t: text.t,
  });
  // macOS must not attach click -> show so left-click opens the assistant menu naturally.
  deps.trays[1].emit("click");
  assert.deepEqual(events, []);
  assert.deepEqual(deps.trays[1].menu.map(i => i.label ?? i.type), ["Quick ask…", "Open OpenMaus Bot", "separator", "Quit OpenMaus Bot"]);
  assert.equal(deps.trays[1].menu[0].accelerator, "Alt+Space");
  deps.trays[1].menu[0].click();
  assert.deepEqual(events, ["quickAsk"]);

  busy = true;
  accel = null;
  macTray.relabel();
  assert.deepEqual(deps.trays[1].menu.map(i => ({ label: i.label ?? i.type, enabled: i.enabled, accelerator: i.accelerator })), [
    { label: "Working on this computer", enabled: false, accelerator: undefined },
    { label: "Pause computer actions", enabled: undefined, accelerator: undefined },
    { label: "separator", enabled: undefined, accelerator: undefined },
    { label: "Quick ask…", enabled: undefined, accelerator: undefined },
    { label: "Open OpenMaus Bot", enabled: undefined, accelerator: undefined },
    { label: "separator", enabled: undefined, accelerator: undefined },
    { label: "Quit OpenMaus Bot", enabled: undefined, accelerator: undefined },
  ]);
  deps.trays[1].menu[1].click();
  assert.deepEqual(events, ["quickAsk", "interrupt"]);

  // Minimal Tray stub without `.on` must not throw.
  class MinimalTray { setToolTip() {} setContextMenu() {} isDestroyed() { return false; } }
  assert.doesNotThrow(() => createSystemTray({
    Tray: MinimalTray, Menu: deps.Menu, nativeImage: deps.nativeImage, iconPath: APP_ICON,
    getWindow: () => null, onQuit: () => {}, onQuickAsk: () => {}, platform: "win32",
  }));
});

test("spotlightHtml inline script handles Enter submit, Esc stop/dismiss, Cmd+Enter openChat, and safe textContent", async () => {
  const dom = new DomWindow({
    url: "about:blank",
    settings: { enableJavaScriptEvaluation: true, suppressInsecureJavaScriptEnvironmentWarning: true },
  });
  const calls = [];
  dom.window.spotlight = {
    submit: text => calls.push(["submit", text]),
    stop: () => calls.push(["stop"]),
    openChat: () => calls.push(["openChat"]),
    dismiss: () => calls.push(["dismiss"]),
    resize: h => calls.push(["resize", h]),
  };
  dom.document.open();
  dom.document.write(spotlightHtml("AAAA"));
  dom.document.close();
  const labels = {
    placeholder: "Ask OpenBot anything…", send: "Send", stop: "Stop",
    openChat: "Open in OpenBot", thinking: "Thinking…", emptyHint: "Press Enter to ask · Esc to close",
  };
  dom.window.render({ state: "idle", busy: false, text: "", focus: true, labels, theme: "dark" });
  const input = dom.document.getElementById("input");
  const action = dom.document.getElementById("action");
  const answer = dom.document.getElementById("answer");
  assert.equal(action.disabled, true);

  input.value = "Summarize today";
  input.dispatchEvent(new dom.window.Event("input"));
  assert.equal(action.disabled, false);
  input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  assert.deepEqual(calls.filter(([k]) => k !== "resize"), [["submit", "Summarize today"]]);

  dom.window.render({ state: "streaming", busy: true, text: "<img src=x onerror=alert(1)>\nLine 2", focus: false, labels });
  assert.equal(answer.textContent, "<img src=x onerror=alert(1)>\nLine 2");
  assert.equal(answer.children.length, 0);
  assert.equal(action.textContent, "Stop");
  dom.window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  assert.deepEqual(calls.at(-1), ["stop"]);

  dom.window.render({ state: "done", busy: false, text: "Done", focus: true, labels });
  dom.window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true, cancelable: true }));
  dom.window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  assert.deepEqual(calls.slice(-2), [["openChat"], ["dismiss"]]);
  await dom.close();
});
