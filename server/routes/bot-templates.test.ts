import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";

import type { PublishedPageCard } from "../../shared/published-page.ts";
import type { BotRecord, Store } from "../store.ts";
import type { PagePublisher } from "../pages/publisher.ts";
import type { RouteContext } from "./table.ts";
import { createBotTemplateRoutes } from "./bot-templates.ts";

function fixture() {
  const bot = {
    id: "bot-1", threadId: "thread-1", name: "Scout", title: "Research helper", description: "A portable bot",
    soul: "Research public information. Never include token=sk-proj-123456789012345678901234.",
    color: "blue", mascotBody: "circle", mascotExpression: null, yourAccess: "full", playbooks: [],
  } as unknown as BotRecord;
  const messages: Array<{ id: string; role: string; kind: string; text: string; publishedPage?: PublishedPageCard }> = [];
  const store = {
    botByThread: vi.fn((threadId: string) => threadId === bot.threadId ? bot : undefined),
    messagesFor: vi.fn(() => messages),
    appendMessage: vi.fn((_threadId: string, message: Omit<(typeof messages)[number], "id">) => { const saved = { ...message, id: `message-${messages.length + 1}` }; messages.push(saved); return saved; }),
    patchMessage: vi.fn((_threadId: string, messageId: string, patch: Partial<(typeof messages)[number]>) => { const saved = messages.find((entry) => entry.id === messageId); if (saved) Object.assign(saved, patch); return saved; }),
  } as unknown as Store;
  const publishFiles = vi.fn(async (_input: Parameters<PagePublisher["publishFiles"]>[0]) => ({ status: 200 as const, text: "Published", card: { state: "live" as const, title: "Scout", pageId: "a".repeat(20), url: "https://pages.example/abc" } }));
  const handler = createBotTemplateRoutes({ store, publisher: { publishFiles } as unknown as PagePublisher });
  const call = async (path: string, method: string, body?: unknown) => {
    let result: { status: number; body: any } | undefined;
    await handler({
      req: { headers: {} } as IncomingMessage, res: {} as ServerResponse,
      url: new URL(`http://localhost${path}`), path, method,
      auth: { kind: "loopback", scopes: ["admin"] },
      json: ((_res: ServerResponse, status: number, response: unknown) => { result = { status, body: response }; }) as RouteContext["json"],
      readBody: (async () => body) as RouteContext["readBody"],
    });
    return result;
  };
  return { bot, messages, publishFiles, call };
}

describe("Bot template routes", () => {
  it("creates a draft, previews a portable redacted package, then publishes only after explicit confirmation", async () => {
    const { messages, publishFiles, call } = fixture();
    const draft = await call("/api/threads/thread-1/bot-template", "POST", {});
    expect(draft?.status).toBe(201);
    expect(messages[0]?.publishedPage).toMatchObject({ kind: "bot-template", templateState: "draft", title: "Scout" });

    const preview = await call("/api/threads/thread-1/messages/message-1/bot-template/preview", "POST", {});
    expect(preview?.status).toBe(200);
    expect(preview?.body.document.version).toBe(2);
    expect(JSON.stringify(preview?.body.document)).not.toContain("sk-proj-123456789012345678901234");
    expect(preview?.body.redacted.length).toBeGreaterThan(0);

    expect((await call("/api/threads/thread-1/messages/message-1/bot-template/publish", "POST", {}))?.status).toBe(400);
    const published = await call("/api/threads/thread-1/messages/message-1/bot-template/publish", "POST", { confirmed: true });
    expect(published?.status).toBe(200);
    expect(publishFiles).toHaveBeenCalledOnce();
    expect(publishFiles.mock.calls[0]?.[0]?.files.map((file) => file.path)).toEqual(["index.html", "bot-template.openmaus.json"]);
    expect(messages[0]?.publishedPage).toMatchObject({ kind: "bot-template", templateState: "published", url: "https://pages.example/abc" });
  });
});
