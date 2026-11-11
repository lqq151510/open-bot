import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import type { CloudUsage } from "../../electron/cloud-home.mjs";
import type { Disclose } from "./SettingsSimplePages";

const fixture = vi.hoisted(() => ({ usage: null as CloudUsage | null, planKind: "signed-out" }));

vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => false }));
vi.mock("./PlanUsage", () => ({ PlanUsageSummary: () => "PLAN USAGE" }));
vi.mock("./UsageSection", () => ({ UsageSection: () => null }));
vi.mock("./ProIntroduction", () => ({
  useCloudPlan: () => ({ view: { kind: fixture.planKind }, account: null }),
  CloudPlanRow: () => null,
  CloudPlanFootnote: () => null,
}));
vi.mock("./CloudUsageMeter", async (original) => {
  const actual = await original<typeof import("./CloudUsageMeter")>();
  return {
    ...actual,
    useCloudUsageSettings: () => ({
      usage: fixture.usage,
      upgrade: { busy: null, note: null, onUpgrade: () => {} },
      dialog: null,
    }),
  };
});

const { SimpleBillingPage } = await import("./SettingsSimplePages");

const has = () => true;
const disclose: Disclose = (id) => ({ id, open: true, onToggle: () => {} });
const html = () => renderToStaticMarkup(createElement(SimpleBillingPage, { has, disclose, cloudAccount: "EXISTING CLOUD ACCOUNT" }));

const usage = (used: number): CloudUsage => ({
  tier: "personal",
  resetsAt: Date.UTC(2026, 10, 20),
  meters: [{ kind: "decisions", used, max: 100 }],
  upgrades: [],
});

beforeEach(() => {
  setLocale("en");
  fixture.usage = null;
  fixture.planKind = "signed-out";
});

describe("simple billing", () => {
  it("shows an empty state instead of the sample allowance", () => {
    const text = html();
    expect(text).toContain("data-billing-empty");
    expect(text).toContain("Your bots use the AI accounts you connected in Settings.");
    expect(text).toContain("Nothing to show yet.");
    for (const sample of ["91%", "$3.75", "$3.91", "$10.00", "Premium", "Buy allowance", "auto-reload", "cursor.com"]) {
      expect(text).not.toContain(sample);
    }
    expect(text).not.toContain("EXISTING CLOUD ACCOUNT");
  });

  it("renders the cloud usage that is actually on the account", () => {
    fixture.usage = usage(40);
    fixture.planKind = "paid";
    const text = html();
    expect(text).toContain("40%");
    expect(text).toContain("used");
    expect(text).not.toContain("data-billing-empty");
    expect(text).not.toContain("91%");
    expect(text).not.toContain("$3.75");
    expect(text).not.toContain("Premium");
    expect(text).toContain("EXISTING CLOUD ACCOUNT");
  });
});
