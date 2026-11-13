export const MAUS_COLOR_NAMES = [
  "green", "blue", "red", "orange", "purple", "cyan", "pink",
  "yellow", "teal", "coral", "silver", "chrome",
] as const;
export type PresetMausColor = (typeof MAUS_COLOR_NAMES)[number];
export type CustomMausColor = `#${string}`;
export type MausColor = PresetMausColor | CustomMausColor;

export function isCustomMausColor(value: unknown): value is CustomMausColor {
  return typeof value === "string" && value.length === 7 && /^#[0-9a-f]{6}$/i.test(value);
}

export function isMausColor(value: unknown): value is MausColor {
  return isCustomMausColor(value) || (typeof value === "string" && (MAUS_COLOR_NAMES as readonly string[]).includes(value));
}
