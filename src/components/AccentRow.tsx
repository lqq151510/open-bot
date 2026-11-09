import { t } from "@/lib/i18n";
import { ACCENTS, applyAccent, useAccent } from "@/lib/accent";
import type { LocaleKey } from "@/locales";
import { SettingRow } from "./SettingsPrimitives";
import { Select } from "./Select";

const LABELS: Record<(typeof ACCENTS)[number]["id"], LocaleKey> = {
  ink: "settings.accent.ink",
  blue: "settings.accent.blue",
  green: "settings.accent.green",
  orange: "settings.accent.orange",
  pink: "settings.accent.pink",
  violet: "settings.accent.violet",
};

export function AccentRow() {
  const accent = useAccent();
  return (
    <SettingRow title={t("settings.accent.title")} subtitle={t("settings.accent.subtitle")}>
      <Select size="sm" variant="ghost" value={accent} aria-label={t("settings.accent.title")} onChange={(event) => applyAccent(event.target.value as (typeof ACCENTS)[number]["id"])}>
        {ACCENTS.map((entry) => (
          <option key={entry.id} value={entry.id}>{t(LABELS[entry.id])}</option>
        ))}
      </Select>
    </SettingRow>
  );
}
