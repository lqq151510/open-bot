import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import nativeText from "./native-text.cjs";
import { TalkServerError } from "./talk-server.mjs";

export const SPOTLIGHT_PANEL = Object.freeze({ width: 560, minHeight: 64, maxHeight: 360, topRatio: 0.18 });
export const SPOTLIGHT_SHORTCUTS = Object.freeze(["Alt+Space", "CommandOrControl+Shift+Space"]);

const ICON_PX = 24;
const LIGHT = "color-scheme:light;--panel:#f7f7f7eb;--border:#0000001f;--ink:#0d0d0d;--ink2:#303030;--muted:#00000073;--surface:#0000000a;--accent:#0b62c4;--accent-ink:#ffffff;--danger:#c02b3a;--hover:#0000000f";
const ERROR_KEYS = new Map([
  ["starting", ["native.talk.starting", "OpenBot is still starting. Try again in a moment."]],
  ["server-down", ["native.talk.openOpenBot", "Open OpenBot to talk"]],
  ["no-openbot", ["native.talk.setUpFirst", "Set up OpenBot first, then try again."]],
  ["moved", ["native.talk.movedToCloud", "OpenBot lives on My Cloud now — talk to it there"]],
  ["lost", ["native.talk.stillWorking", "Still working · Open chat"]],
]);
const panels = new WeakSet();

const tr = (t, key, fallback) => {
  const value = typeof t === "function" ? t(key) : key;
  return !value || value === key ? fallback : value;
};

export function isSpotlightPanel(win) {
  return panels.has(win);
}

export function spotlightBounds(workArea, height = SPOTLIGHT_PANEL.minHeight) {
  const raw = Number.isFinite(height) ? height : SPOTLIGHT_PANEL.minHeight;
  const h = Math.min(SPOTLIGHT_PANEL.maxHeight, Math.max(SPOTLIGHT_PANEL.minHeight, Math.round(raw)));
  const maxOffset = Math.max(0, workArea.height - h);
  return {
    x: Math.round(workArea.x + (workArea.width - SPOTLIGHT_PANEL.width) / 2),
    y: Math.round(workArea.y + Math.min(maxOffset, Math.round(workArea.height * SPOTLIGHT_PANEL.topRatio))),
    width: SPOTLIGHT_PANEL.width,
    height: h,
  };
}

export function spotlightHtml(iconBase64) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>OpenBot</title><style>
:root{color-scheme:dark light}
body{color-scheme:dark;--panel:#141416eb;--border:#ffffff1c;--ink:#fcfcfc;--ink2:#e6e6e8;--muted:#fcfcfc78;--surface:#ffffff0f;--accent:#1084fe;--accent-ink:#ffffff;--danger:#ff5667;--hover:#ffffff18}
body.light{${LIGHT}}
@media (prefers-color-scheme: light){body:not(.dark){${LIGHT}}}
*{box-sizing:border-box}html,body{margin:0;background:transparent;overflow:hidden;font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;color:var(--ink)}
#card{display:flex;flex-direction:column;border:1px solid var(--border);border-radius:16px;background:var(--panel);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);overflow:hidden}
#bar{display:flex;align-items:center;gap:10px;min-height:62px;padding:12px 14px}
#icon{flex:none;width:${ICON_PX}px;height:${ICON_PX}px;object-fit:contain;display:block;user-select:none;-webkit-user-drag:none}
#input{flex:1;min-width:0;max-height:92px;padding:4px 0;margin:0;border:0;outline:0;resize:none;background:transparent;color:var(--ink);font:inherit;line-height:20px;overflow-y:auto}
#input::placeholder{color:var(--muted)}
#action{flex:none;height:32px;padding:0 12px;border:0;border-radius:8px;background:var(--accent);color:var(--accent-ink);font:600 12.5px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;cursor:pointer}
#action:hover{filter:brightness(1.08)}#action.stop{background:var(--surface);color:var(--ink);border:1px solid var(--border)}#action:disabled{opacity:.45;cursor:default;filter:none}
#body{display:none;padding:0 14px 10px 48px}body.has-body #body{display:block}
#status{display:none;align-items:center;gap:8px;color:var(--muted);font-size:12.5px;padding-bottom:6px}body.thinking #status{display:flex}
.dot{width:7px;height:7px;border-radius:50%;background:var(--accent);animation:pulse 1.2s ease-in-out infinite}
#answer{display:none;max-height:212px;overflow-y:auto;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--ink2);font-size:13.5px;line-height:1.5;user-select:text}
body.has-answer #answer{display:block}body.error #answer{color:var(--danger)}
#foot{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:7px 14px;border-top:1px solid var(--border);font-size:11.5px;color:var(--muted)}
#hint{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#open{padding:4px 8px;border:0;border-radius:6px;background:transparent;color:var(--accent);font:600 11.5px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;cursor:pointer}
#open:hover{background:var(--hover)}
@keyframes pulse{0%,100%{opacity:.35;transform:scale(.85)}50%{opacity:1;transform:scale(1.15)}}
@media (prefers-reduced-motion: reduce){.dot{animation:none;opacity:.8}}
</style></head><body><div id="card"><div id="bar"><img id="icon" src="data:image/png;base64,${iconBase64}" alt=""><textarea id="input" rows="1"></textarea><button id="action" type="button"></button></div><div id="body"><div id="status" role="status"><span class="dot" aria-hidden="true"></span><span id="status-text"></span></div><div id="answer" role="region" aria-live="polite"></div></div><div id="foot"><span id="hint"></span><button id="open" type="button"></button></div></div><script>
const card=document.getElementById("card"),input=document.getElementById("input"),action=document.getElementById("action"),statusText=document.getElementById("status-text"),answer=document.getElementById("answer"),hint=document.getElementById("hint"),openBtn=document.getElementById("open");
let busy=false,lastLabels={};
const measure=()=>{input.style.height="auto";input.style.height=Math.min(92,Math.max(28,input.scrollHeight))+"px";return Math.ceil(card.getBoundingClientRect().height);};
const syncAction=()=>{action.textContent=busy?(lastLabels.stop||"Stop"):(lastLabels.send||"Send");action.classList.toggle("stop",busy);action.disabled=!busy&&!input.value.trim();};
function render(view){
  lastLabels=view.labels||{};busy=view.busy===true;const text=view.text||"",showThinking=view.state==="sending"||view.state==="thinking",hasAnswer=text.length>0;
  document.body.className=[view.theme,showThinking?"thinking":"",hasAnswer?"has-answer":"",(showThinking||hasAnswer)?"has-body":"",view.state==="error"?"error":""].filter(Boolean).join(" ");
  input.placeholder=lastLabels.placeholder||"Ask OpenBot anything…";
  if(view.restorePrompt&&!input.value)input.value=view.restorePrompt;
  statusText.textContent=lastLabels.thinking||"Thinking…";
  answer.textContent=text;
  hint.textContent=lastLabels.emptyHint||"Press Enter to ask · Esc to close";
  openBtn.textContent=lastLabels.openChat||"Open in OpenBot";
  syncAction();
  if(view.focus){input.focus();if(view.restorePrompt)input.select();}
  return measure();
}
window.render=render;
function sendNow(){const v=input.value.trim();if(!v||busy)return;input.value="";syncAction();window.spotlight.resize(measure());window.spotlight.submit(v);}
input.addEventListener("input",()=>{syncAction();window.spotlight.resize(measure());});
input.addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey&&!e.metaKey&&!e.ctrlKey&&!e.isComposing){e.preventDefault();sendNow();}});
action.addEventListener("click",()=>{if(busy)window.spotlight.stop();else sendNow();});
openBtn.addEventListener("click",()=>window.spotlight.openChat());
window.addEventListener("keydown",e=>{if(e.key==="Escape"){e.preventDefault();if(busy)window.spotlight.stop();else window.spotlight.dismiss();}else if((e.metaKey||e.ctrlKey)&&e.key==="Enter"){e.preventDefault();window.spotlight.openChat();}});
</script></body></html>`;
}

function mascotPng(nativeImage, iconPath) {
  const icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) throw new Error(`no spotlight icon at ${iconPath}`);
  return icon.resize({ width: 2 * ICON_PX, height: 2 * ICON_PX, quality: "best" }).toPNG().toString("base64");
}

export function createSpotlightShortcut({ globalShortcut, available, onToggle }) {
  let registered = null, offered = false;
  const release = () => {
    if (registered) globalShortcut.unregister(registered);
    registered = null;
  };
  const apply = () => {
    release();
    offered = available();
    if (!offered) return;
    for (const candidate of SPOTLIGHT_SHORTCUTS) {
      if (globalShortcut.register(candidate, onToggle)) { registered = candidate; return; }
    }
  };
  apply();
  return {
    accelerator: () => registered,
    refresh() { if (available() !== offered) apply(); },
    close: release,
  };
}

export function createSpotlight({ BrowserWindow, screen, nativeImage, iconPath, server, openChat, theme: initialTheme = null, t = nativeText.englishText.t, log = () => {}, newSendId = randomUUID }) {
  let win = null, loaded = false, shown = false, pendingShow = false, page = null, area = null;
  let lastHeight = SPOTLIGHT_PANEL.minHeight, theme = initialTheme, state = "idle";
  let answer = "", prompt = "", restorePrompt = "", errorCode = null, activeChat = null, inFlight = null, askSeq = 0, paintTicket = 0;

  const workArea = () => screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const live = target => Boolean(target && !target.isDestroyed());
  const busy = () => inFlight !== null;
  const labels = () => ({
    placeholder: tr(t, "native.spotlight.placeholder", "Ask OpenBot anything…"),
    send: tr(t, "native.spotlight.send", "Send"),
    stop: tr(t, "native.spotlight.stop", "Stop"),
    openChat: tr(t, "native.spotlight.openChat", "Open in OpenBot"),
    thinking: tr(t, "native.spotlight.thinking", "Thinking…"),
    emptyHint: tr(t, "native.spotlight.emptyHint", "Press Enter to ask · Esc to close"),
  });

  async function paint({ focus = false } = {}) {
    const target = win;
    if (!live(target) || !loaded) return;
    const ticket = ++paintTicket;
    const text = state === "error" && errorCode ? tr(t, errorCode[0], errorCode[1]) : answer;
    const payload = JSON.stringify({ state, busy: busy(), text, focus, ...(restorePrompt ? { restorePrompt } : {}), labels: labels(), ...(theme ? { theme } : {}) });
    restorePrompt = "";
    let height;
    try { height = await target.webContents.executeJavaScript(`render(${payload})`); } catch { return; }
    if (win !== target || ticket !== paintTicket || !live(target)) return;
    if (Number.isFinite(height) && height > 0) {
      lastHeight = height;
      target.setBounds?.(spotlightBounds(area, height));
    }
    if (pendingShow && !shown) {
      shown = true;
      pendingShow = false;
      target.show?.();
      target.focus?.();
    }
  }

  const repaint = (options) => void paint(options).catch(() => {});
  const abortInFlight = () => {
    if (!inFlight) return false;
    inFlight.controller.abort();
    inFlight = null;
    return true;
  };
  const hide = () => { pendingShow = false; shown = false; if (live(win)) win.hide?.(); };
  const stopStreaming = () => { if (!abortInFlight()) return; state = answer ? "done" : "idle"; repaint({ focus: true }); };
  const dismiss = () => { abortInFlight(); state = "idle"; answer = ""; prompt = ""; restorePrompt = ""; errorCode = null; hide(); };

  function openCurrentChat() {
    const chat = activeChat;
    if (abortInFlight()) state = answer ? "done" : "idle";
    hide();
    try { openChat(chat); } catch (error) { log(`spotlight open failed: ${error?.message ?? error}`); }
  }

  function handleUpdate(id, update) {
    if (!inFlight || inFlight.id !== id) return;
    if (update.kind === "thinking") { state = "thinking"; repaint(); }
    else if (update.kind === "reply") { state = "streaming"; answer = String(update.text ?? "").slice(0, 12000); repaint(); }
    else if (update.kind === "done" && update.text) answer = String(update.text).slice(0, 12000);
    else if (update.kind === "needs-you" && !answer) answer = tr(t, "native.talk.needsYou", "OpenBot needs you · Open chat");
  }

  async function submit(rawText) {
    const text = String(rawText ?? "").trim().slice(0, 4000);
    if (!text || busy()) return;
    const id = ++askSeq, controller = new AbortController();
    inFlight = { id, controller };
    prompt = text; restorePrompt = ""; answer = ""; errorCode = null; state = "sending";
    repaint();
    try {
      const chat = await server.prepare();
      if (!inFlight || inFlight.id !== id) return;
      activeChat = chat;
      const outcome = await server.ask({ chat, text, sendId: newSendId(), signal: controller.signal, onUpdate: update => handleUpdate(id, update) });
      if (!inFlight || inFlight.id !== id) return;
      inFlight = null;
      if (outcome === "failed") { state = "error"; errorCode = ["native.talk.failed", "OpenBot couldn't take that · Open chat"]; }
      else state = "done";
      repaint({ focus: true });
    } catch (error) {
      if (!inFlight || inFlight.id !== id || error?.name === "AbortError") return;
      inFlight = null;
      const code = error instanceof TalkServerError ? error.code : null;
      errorCode = ERROR_KEYS.get(code) ?? ["native.talk.failed", "OpenBot couldn't take that · Open chat"];
      restorePrompt = prompt;
      state = "error";
      repaint({ focus: true });
    }
  }

  function create() {
    page ??= `data:text/html;charset=utf-8,${encodeURIComponent(spotlightHtml(mascotPng(nativeImage, iconPath)))}`;
    area = workArea();
    const target = new BrowserWindow({
      ...spotlightBounds(area, SPOTLIGHT_PANEL.minHeight),
      frame: false, transparent: true, backgroundColor: "#00000000", alwaysOnTop: true, skipTaskbar: true,
      hasShadow: false, resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
      show: false, hiddenInMissionControl: true,
      webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true, preload: fileURLToPath(new URL("./spotlight-preload.cjs", import.meta.url)) },
    });
    panels.add(target);
    target.excludedFromShownWindowsMenu = true;
    target.setAlwaysOnTop?.(true, "floating");
    target.setVisibleOnAllWorkspaces?.(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    target.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    target.webContents.on("will-navigate", event => event.preventDefault());
    target.webContents.on("did-finish-load", () => { if (win === target) { loaded = true; repaint({ focus: pendingShow || shown }); } });
    target.webContents.on("ipc-message", (_event, channel, value) => {
      if (channel === "spotlight:submit") void submit(value);
      else if (channel === "spotlight:stop") stopStreaming();
      else if (channel === "spotlight:open-chat") openCurrentChat();
      else if (channel === "spotlight:dismiss") dismiss();
      else if (channel === "spotlight:resize") {
        const h = Number(value);
        if (Number.isFinite(h) && h > 0 && win === target && live(target)) { lastHeight = h; target.setBounds?.(spotlightBounds(area, h)); }
      }
    });
    target.on("blur", () => { if (win === target && shown && !busy()) hide(); });
    target.on("closed", () => { if (win === target) { win = null; loaded = false; shown = false; pendingShow = false; } });
    target.loadURL(page).catch(error => log(`spotlight load failed: ${error?.message ?? error}`));
    return target;
  }

  function open() {
    if (!busy() && !shown) { state = "idle"; answer = ""; prompt = ""; restorePrompt = ""; errorCode = null; lastHeight = SPOTLIGHT_PANEL.minHeight; }
    area = workArea();
    if (!live(win)) { win = create(); loaded = false; pendingShow = true; return; }
    win.setBounds?.(spotlightBounds(area, lastHeight));
    if (loaded) { shown = true; pendingShow = false; win.show?.(); win.focus?.(); repaint({ focus: true }); }
    else pendingShow = true;
  }

  return {
    toggle() {
      if ((shown || pendingShow) && live(win)) {
        if (typeof win.isFocused === "function" && !win.isFocused()) { win.show?.(); win.focus?.(); repaint({ focus: true }); return; }
        hide();
        return;
      }
      open();
    },
    open,
    hide,
    busy,
    setTheme(next) { if (next !== theme) { theme = next; if (win && loaded) repaint(); } },
    relabel() { if (win && loaded) repaint(); },
    close() {
      abortInFlight();
      pendingShow = false; shown = false;
      const target = win; win = null; loaded = false;
      if (live(target)) target.destroy?.();
    },
  };
}
