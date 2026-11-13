import { t } from "@/lib/i18n";
import { isCustomMausColor, mascotColorHex, type MausColor } from "@/lib/mascot";

export function MascotColorPicker({ color, disabled, onChange }: {
  color: MausColor;
  disabled?: boolean;
  onChange: (color: MausColor) => void;
}) {
  return (
    <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-lg border border-hairline/50 px-2.5 py-1.5 text-[13px] text-ink-secondary">
      <input
        type="color"
        value={mascotColorHex(color)}
        disabled={disabled}
        onChange={(event) => {
          const value = event.currentTarget.value;
          if (isCustomMausColor(value)) onChange(value);
        }}
        className="h-6 w-7 cursor-pointer bg-transparent p-0 focus-visible:outline-2 focus-visible:outline-focus disabled:cursor-not-allowed"
      />
      {t("mascotColor.custom")}
      {isCustomMausColor(color) && <span className="font-mono text-[12px]">{color.toUpperCase()}</span>}
    </label>
  );
}
