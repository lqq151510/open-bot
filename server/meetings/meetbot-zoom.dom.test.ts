import { Window } from "happy-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pageOp } from "./meetbot.ts";

const page = new Window({ url: "https://app.zoom.us/wc/123456789/join" });
beforeEach(() => {
  vi.stubGlobal("document", page.document);
  vi.stubGlobal("location", page.location);
  vi.stubGlobal("getComputedStyle", page.getComputedStyle.bind(page));
});
afterEach(() => {
  page.document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function show(html: string) {
  page.document.body.innerHTML = html;
  vi.spyOn(page.HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 100, height: 30 } as never);
}

describe("Zoom meeting page", () => {
  it("does not mistake Teams controls for Zoom admission or speaker activity", () => {
    show('<button id="hangup-button">Leave</button><div data-tid="voice-level-stream-outline" data-is-speaking="true"></div>');
    expect(pageOp({ op: "probe", platform: "zoom", self: "OpenBot" }).inMeeting).toBe(false);
    expect(pageOp({ op: "speaker", platform: "zoom", self: "OpenBot" })).toBeNull();
  });

  it("recognizes a Zoom meeting, waiting room and blocked admission", () => {
    show('<div class="meeting-app"><button aria-label="Leave"></button><button aria-label="Participants (3)"></button><span class="participants-item__display-name">OpenBot</span><span class="participants-item__display-name">Ada</span></div>');
    expect(pageOp({ op: "probe", platform: "zoom", self: "OpenBot" })).toMatchObject({ inMeeting: true, others: 2, names: ["Ada"] });
    page.document.body.innerHTML = "<p>Please wait, the meeting host will let you in soon.</p>";
    expect(pageOp({ op: "probe", platform: "zoom", self: "OpenBot" })).toMatchObject({ inMeeting: false, lobby: true });
    page.document.body.innerHTML = "<p>Automated bots aren't allowed to join this meeting.</p>";
    expect(pageOp({ op: "probe", platform: "zoom", self: "OpenBot" })).toMatchObject({ inMeeting: false, blocked: true });
  });

  it("does not mark a name or a row without a stable ID as proof of our own notice", () => {
    show('<div aria-label="Chat Message List"><div class="new-chat-message__container"><span class="chat-message-text__user-name">You</span><span class="text-wrapper">notice</span></div><div id="chat-message-7"><span class="chat-message-text__user-name">OpenBot</span><span class="text-wrapper">notice</span></div></div>');
    const messages = pageOp({ op: "chat", platform: "zoom", self: "OpenBot" });
    expect(messages).toMatchObject([{ messageId: null, isSelf: false }, { messageId: "chat-message-7", isSelf: false }]);
  });

  it("extracts explicit Zoom chat rows and an active speaker without guessing missing authors", () => {
    show('<div aria-label="Chat Message List"><div id="chat-message-1"><span class="chat-message-text__user-name">Ada</span><span class="text-wrapper">@notes hello</span></div><div id="chat-message-2"><span class="text-wrapper">anonymous text</span></div></div><div class="speaker-active-container__video-frame"><span class="video-avatar__avatar-footer">Ada</span></div>');
    expect(pageOp({ op: "chat", platform: "zoom" })).toEqual([
      { key: "chat-message-1|Ada|@notes hello", messageId: "chat-message-1", isSelf: false, from: "Ada", text: "@notes hello" },
      { key: "chat-message-2||anonymous text", messageId: "chat-message-2", isSelf: false, from: "", text: "anonymous text" },
    ]);
    expect(pageOp({ op: "speaker", platform: "zoom", self: "OpenBot" })).toBe("Ada");
  });
});
