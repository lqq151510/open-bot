import { describe, expect, it, vi } from "vitest";
import { createBotEngine, type MeetingComputer } from "./engine.ts";

const start = {
  id: "m-12345678", url: "https://meet.google.com/abc-defg-hij?pwd=fixture-password", platform: "meet" as const,
  name: "Fixture", consent: "Notice", speech: { kind: "eleven" as const, token: "fixture-one-time-token" },
  maxMs: 10, lobbyMs: 10, aloneMs: 10,
};

describe("meeting private uploads", () => {
  it("uploads config and later commands without placing their contents in remote commands", async () => {
    const commands: string[] = [];
    const uploads: Array<{ path: string; contents: string }> = [];
    const computer: MeetingComputer = {
      run: async (command) => { commands.push(command); return { ok: true, stdout: "", stderr: "" }; },
      start: async (command) => { commands.push(command); return { ok: true }; },
      upload: async (path, contents) => { uploads.push({ path, contents }); },
    };
    const engine = createBotEngine(() => ({ text: "fixture", file: "$HOME/.openbot-meet/meetbot-test.mjs" }));
    await engine.join(computer, start);
    await engine.supply(computer, start.id, { kind: "eleven", token: "fixture-rotated-token" });
    await engine.chatSend(computer, start.id, { id: "chat-1", text: "fixture-private-chat" });
    expect(uploads).toHaveLength(3);
    expect(JSON.parse(uploads[0]!.contents)).toMatchObject({ url: start.url, stt: { token: start.speech.token } });
    expect(JSON.parse(uploads[1]!.contents)).toEqual({ kind: "token", token: "fixture-rotated-token" });
    expect(JSON.parse(uploads[2]!.contents)).toEqual({ kind: "chat", id: "chat-1", text: "fixture-private-chat" });
    for (const upload of uploads) {
      expect(upload.path).toMatch(/^\/home\/user\/\.openbot-meet\/m-12345678\//);
      expect(commands.join("\n")).not.toContain(upload.contents);
      expect(commands.join("\n")).not.toContain(Buffer.from(upload.contents).toString("base64"));
    }
    for (const secret of ["fixture-password", "fixture-one-time-token", "fixture-rotated-token", "fixture-private-chat"]) {
      expect(commands.join("\n")).not.toContain(secret);
    }
  });

  it("fails closed and removes its temporary remote file when upload is unavailable", async () => {
    const commands: string[] = [];
    const computer: MeetingComputer = {
      run: async (command) => { commands.push(command); return { ok: true, stdout: "", stderr: "" }; },
      start: vi.fn(async () => ({ ok: true as const })),
      upload: async () => { throw new Error("Secure meeting upload failed."); },
    };
    const engine = createBotEngine(() => ({ text: "fixture", file: "$HOME/.openbot-meet/meetbot-test.mjs" }));
    await expect(engine.join(computer, start)).rejects.toThrow("Secure meeting upload failed.");
    expect(computer.start).not.toHaveBeenCalled();
    expect(commands.at(-1)).toMatch(/^if \[ .*config-[a-f0-9-]+\.tmp -ef .*\/config\.json \]/);
    expect(commands.join("\n")).not.toContain("fixture-password");
  });

  it("cleans the published config if removing its temporary link fails", async () => {
    const commands: string[] = [];
    const computer: MeetingComputer = {
      run: async (command) => {
        commands.push(command);
        const failing = /^rm -f .*config-[a-f0-9-]+\.tmp$/.test(command);
        return { ok: !failing, stdout: "", stderr: failing ? "fixture failure" : "" };
      },
      start: vi.fn(async () => ({ ok: true as const })),
      upload: async () => {},
    };
    const engine = createBotEngine(() => ({ text: "fixture", file: "$HOME/.openbot-meet/meetbot-test.mjs" }));
    await expect(engine.join(computer, start)).rejects.toThrow("Finishing the meeting setup");
    expect(computer.start).not.toHaveBeenCalled();
    expect(commands.at(-1)).toMatch(/^rm -f .*\.tmp .*\/config\.json$/);
  });

  it("reports an uncertain delivery when publishing an inbox command fails", async () => {
    const commands: string[] = [];
    const computer: MeetingComputer = {
      run: async (command) => {
        commands.push(command);
        return { ok: !command.includes(" && ln "), stdout: "", stderr: "" };
      },
      start: async () => ({ ok: true }),
      upload: async () => {},
    };
    const engine = createBotEngine(() => ({ text: "fixture", file: "$HOME/.openbot-meet/meetbot-test.mjs" }));
    await expect(engine.chatSend(computer, start.id, { id: "chat-1", text: "private chat" }))
      .rejects.toThrow("may have been delivered. Check the meeting before retrying.");
    expect(commands.at(-1)).toMatch(/^rm -f .*\.tmp$/);
    expect(commands.join("\n")).not.toContain("private chat");
  });
});
