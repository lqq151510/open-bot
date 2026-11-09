import { z } from "zod";
import type { PublishedPageCard } from "../../shared/published-page.ts";
import { redactPackageSecrets } from "../../shared/package-format.ts";
import { upgradeV1 } from "../bot-package.ts";
import { createBotPackageExport } from "../package-export.ts";
import type { PagePublisher } from "../pages/publisher.ts";
import type { BotRecord, Store } from "../store.ts";
import { PASS, type RouteHandler } from "./table.ts";

const DRAFT = /^\/api\/threads\/([\w-]+)\/bot-template$/;
const MESSAGE = /^\/api\/threads\/([\w-]+)\/messages\/([\w-]+)\/bot-template\/(preview|publish)$/;
const draftBody = z.object({ name: z.string().trim().min(1).max(100).optional(), description: z.string().trim().max(500).optional() }).strict();
const publishBody = z.object({ confirmed: z.literal(true) }).strict();
const TEMPLATE_FILE = "bot-template.openmaus.json";

function html(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function templatePackage(bot: BotRecord, card: PublishedPageCard) {
  const source = { ...bot, name: card.title, description: card.description ?? "", avatarUrl: undefined };
  const document = createBotPackageExport({ name: card.title, bots: [source], groups: [], routines: [] });
  return redactPackageSecrets(upgradeV1(document));
}

function landingPage(card: PublishedPageCard): Buffer {
  const title = html(card.title);
  const description = html(card.description ?? "");
  return Buffer.from(`<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · OpenBot 模板</title>
<style>body{font:16px/1.65 system-ui,sans-serif;color:#171717;background:#fafafa;margin:0}.page{max-width:680px;margin:12vh auto;padding:40px;background:white;border:1px solid #e8e8e8;border-radius:24px;box-shadow:0 12px 40px #0000000a}h1{font-size:28px;line-height:1.25;margin:0 0 14px}p{color:#666;white-space:pre-wrap}.button{display:inline-flex;margin-top:18px;padding:11px 18px;border-radius:999px;background:#171717;color:white;text-decoration:none}@media(max-width:720px){.page{margin:20px;padding:28px}}</style>
<main class="page"><h1>${title}</h1><p>${description}</p><a class="button" href="./${TEMPLATE_FILE}" download>下载 OpenBot 模板</a></main></html>\n`, "utf8");
}

export function createBotTemplateRoutes(deps: { store: Store; publisher: PagePublisher }): RouteHandler {
  return async ({ req, res, path, method, json, readBody }) => {
    const draft = DRAFT.exec(path);
    if (draft && method === "POST") {
      const [, threadId] = draft;
      const bot = deps.store.botByThread(threadId);
      if (!bot || bot.yourAccess === "view") return void json(res, 404, { error: "This Bot cannot create a public template." });
      const body = draftBody.safeParse(await readBody(req, 16_384) ?? {});
      if (!body.success) return void json(res, 400, { error: "Choose a template name and description." });
      const card: PublishedPageCard = {
        state: "unpublished", kind: "bot-template", templateState: "draft",
        title: body.data.name || bot.name, description: body.data.description ?? bot.description,
        botColor: bot.color || "green", mascotBody: bot.mascotBody || undefined, mascotExpression: bot.mascotExpression,
      };
      const message = deps.store.appendMessage(threadId, { role: "bot", kind: "text", text: "", publishedPage: card });
      return void json(res, 201, { message });
    }

    const match = MESSAGE.exec(path);
    if (!match || method !== "POST") return PASS;
    const [, threadId, messageId, action] = match;
    const bot = deps.store.botByThread(threadId);
    const message = deps.store.messagesFor(threadId).find((entry) => entry.id === messageId);
    const card = message?.publishedPage;
    if (!bot || !card || card.kind !== "bot-template") return void json(res, 404, { error: "This Bot template is no longer available." });

    if (action === "preview") {
      const exported = templatePackage(bot, card);
      return void json(res, 200, { document: exported.document, redacted: exported.redacted });
    }

    const body = publishBody.safeParse(await readBody(req, 2_048) ?? {});
    if (!body.success) return void json(res, 400, { error: "Review the template and confirm before publishing." });
    const exported = templatePackage(bot, card);
    const packageBytes = Buffer.from(`${JSON.stringify(exported.document, null, 2)}\n`, "utf8");
    const files = [
      { path: "index.html", data: landingPage(card) },
      { path: TEMPLATE_FILE, data: packageBytes },
    ];
    const result = await deps.publisher.publishFiles({
      botId: bot.id,
      threadId,
      title: card.title,
      source: `bot-template:${threadId}/${messageId}`,
      ...(card.templateState === "published" && card.pageId ? { pageId: card.pageId } : {}),
      files,
      post: () => messageId,
    });
    if (result.card) {
      const merged: PublishedPageCard = {
        ...result.card,
        kind: "bot-template",
        templateState: result.card.state === "live" ? "published" : "draft",
        title: card.title,
        description: card.description,
        botColor: card.botColor,
        mascotBody: card.mascotBody,
        mascotExpression: card.mascotExpression,
      };
      deps.store.patchMessage(threadId, messageId, { text: result.text, publishedPage: merged });
      return void json(res, result.status, { card: merged, ...(result.status === 200 ? { ok: true } : { error: result.text }) });
    }
    return void json(res, result.status, result.status === 200 ? { ok: true, card: result.card } : { error: result.text });
  };
}
