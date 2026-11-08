import { Bot, Box, Brain, Code2, Film, Flame, Github, Globe, Mail, MessageCircle, MessageSquare, Monitor, MousePointer2, Palette, ScanSearch, Search, Server, Smile, SquareTerminal, Webhook, Workflow, BookOpen } from "lucide-react";

const icons = [
  { match: /飞书|feishu|lark/i, icon: MessageCircle, color: "#3370ff" },
  { match: /钉钉|dingtalk/i, icon: MessageSquare, color: "#1480f0" },
  { match: /github/i, icon: Github, color: "#24292f" },
  { match: /gmail/i, icon: Mail, color: "#d93025" },
  { match: /kaixin.*memory/i, icon: Brain, color: "#8257d8" },
  { match: /playwright/i, icon: Workflow, color: "#2e8540" },
  { match: /context7/i, icon: BookOpen, color: "#245bdb" },
  { match: /apifox/i, icon: Webhook, color: "#e45351" },
  { match: /ollama/i, icon: Bot, color: "#4d5058" },
  { match: /ffmpeg/i, icon: Film, color: "#249047" },
  { match: /cursor/i, icon: MousePointer2, color: "#353842" },
  { match: /firecrawl/i, icon: Flame, color: "#e65524" },
  { match: /tavily/i, icon: Search, color: "#6548d4" },
  { match: /serena/i, icon: Code2, color: "#247dab" },
  { match: /computer[-_ ]?use/i, icon: Monitor, color: "#2878c5" },
  { match: /node[-_ ]?repl/i, icon: SquareTerminal, color: "#37864a" },
  { match: /blender/i, icon: Box, color: "#ea7600" },
  { match: /^rea$/i, icon: ScanSearch, color: "#7a59a5" },
  { match: /hugging[-_ ]?face/i, icon: Smile, color: "#c48900" },
  { match: /stitch/i, icon: Palette, color: "#3c6fdb" },
  { match: /browser/i, icon: Globe, color: "#3983b4" },
];

const brandIcons: ReadonlyArray<[RegExp, string]> = [
  [/github/i, "github"], [/gmail/i, "gmail"], [/apifox/i, "apifox"], [/ollama/i, "ollama"],
  [/ffmpeg/i, "ffmpeg"], [/cursor/i, "cursor"], [/node[-_ ]?repl/i, "nodedotjs"],
  [/blender/i, "blender"], [/hugging[-_ ]?face/i, "huggingface"],
  [/google[-_ ]?calendar/i, "googlecalendar"], [/notion/i, "notion"], [/figma/i, "figma"],
  [/google[-_ ]?docs/i, "googledocs"], [/cloudflare/i, "cloudflare"], [/supabase/i, "supabase"], [/vercel/i, "vercel"],
  [/1password/i, "1password"], [/airtable/i, "airtable"], [/asana/i, "asana"], [/atlassian/i, "atlassian"],
  [/datadog/i, "datadog"], [/discord/i, "discord"], [/dropbox/i, "dropbox"], [/elevenlabs/i, "elevenlabs"],
  [/google[-_ ]?drive/i, "googledrive"], [/google[-_ ]?sheets/i, "googlesheets"], [/google[-_ ]?slides/i, "googleslides"],
  [/hubspot/i, "hubspot"], [/intercom/i, "intercom"], [/jira/i, "jira"], [/linear/i, "linear"],
  [/posthog/i, "posthog"], [/postman/i, "postman"], [/reddit/i, "reddit"], [/semrush/i, "semrush"],
  [/sentry/i, "sentry"], [/shopify/i, "shopify"], [/stripe/i, "stripe"], [/trello/i, "trello"], [/^x$/i, "x"], [/zapier/i, "zapier"],
];

export function McpConnectorIcon({ name, showInitial = false }: { name: string; showInitial?: boolean }) {
  const item = icons.find(entry => entry.match.test(name));
  const Icon = item?.icon ?? Server;
  const brand = brandIcons.find(([match]) => match.test(name))?.[1];
  return <span aria-hidden="true" data-mcp-icon={brand ?? (item ? String(icons.indexOf(item)) : "other")}
    className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-control" style={{ color: item?.color }}>
    {brand ? <span className="size-5 bg-current" style={{ mask: `url(${import.meta.env.BASE_URL}connector-icons/${brand}.svg) center / contain no-repeat` }} />
      : !item && showInitial ? <span className="text-sm font-semibold">{name.trim().slice(0, 1).toLocaleUpperCase()}</span> : <Icon size={19} />}
  </span>;
}
