export const LOCAL_APP_DIRECTORY = [
  { category: "Productivity", apps: ["飞书 Feishu", "钉钉 DingTalk", "Notion", "Atlassian", "Google Docs", "Google Sheets", "Google Drive", "Canva", "Linear", "OneDrive", "Asana", "Trello", "Airtable"] },
  { category: "Communication", apps: ["Gmail", "Google Calendar", "Outlook", "Slack", "Discord", "X", "Email"] },
  { category: "Design", apps: ["Figma", "Canva", "Google Slides", "Docs Canvas", "PR Review Canvas", "Mobbin"] },
  { category: "Developer tools", apps: ["GitHub", "Datadog", "Superpowers", "Vercel", "Supabase", "Cloudflare", "Sentry", "Postman"] },
  { category: "Analytics", apps: ["Hugging Face", "Firecrawl", "Parallel", "Apify", "PostHog"] },
  { category: "Sales and CRM", apps: ["Granola", "Apollo.io", "HubSpot", "Adspirer", "Clay", "Crustdata", "Salesforce"] },
  { category: "Marketing", apps: ["Klaviyo", "BulkPublish", "MailerLite", "Brevo"] },
  { category: "Finance", apps: ["Stripe", "Shopify Merchant", "Link", "Kraken", "Phantom", "Shop", "X Money", "Finance"] },
  { category: "Research", apps: ["Parallel", "Context.dev", "Ahrefs", "Treg", "Context7", "Semrush"] },
  { category: "Support", apps: ["Intercom", "Plain"] },
  { category: "Password managers", apps: ["1Password"] },
  { category: "Creative", apps: ["Higgsfield", "TubeAlfred", "Dropbox", "ElevenLabs"] },
] as const;

export function findLocalAppGroups(search: string) {
  const term = search.trim().toLocaleLowerCase();
  return LOCAL_APP_DIRECTORY.map(group => ({
    ...group,
    apps: group.apps.filter(name => !term || name.toLocaleLowerCase().includes(term)),
  })).filter(group => group.apps.length > 0);
}
