import { useSyncExternalStore } from "react";
import { subscribeSkin } from "./skins";

export const ACCENT_KEY = "omb-accent";

/** Each accent carries the ink its skin needs: a black accent on a dark skin would vanish. */
export const ACCENTS = [
  { id: "ink", light: "#111111", dark: "#f5f5f5" },
  { id: "blue", light: "#1084fe", dark: "#459ffe" },
  { id: "green", light: "#1a9c62", dark: "#38d591" },
  { id: "orange", light: "#c96a12", dark: "#f0a04b" },
  { id: "pink", light: "#d63384", dark: "#f472b6" },
  { id: "violet", light: "#7c3aed", dark: "#a78bfa" },
] as const;

export type AccentId = (typeof ACCENTS)[number]["id"];
export const DEFAULT_ACCENT: AccentId = "ink";

const DARK_SKINS = new Set(["midnight", "foundry", "dusk", "halloween"]);
const listeners = new Set<() => void>();

function isAccent(value: unknown): value is AccentId {
  return ACCENTS.some((accent) => accent.id === value);
}

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function readAccent(): AccentId {
  try {
    const saved = storage()?.getItem(ACCENT_KEY);
    if (isAccent(saved)) return saved;
  } catch {
  }
  return DEFAULT_ACCENT;
}

function paintAccent(id: AccentId): void {
  if (typeof document === "undefined") return;
  const accent = ACCENTS.find((entry) => entry.id === id) ?? ACCENTS[0];
  const skin = document.documentElement.dataset.skin ?? "";
  const ink = DARK_SKINS.has(skin) ? accent.dark : accent.light;
  const root = document.documentElement.style;
  root.setProperty("--color-accent", ink);
  root.setProperty("--color-focus", ink);
  root.setProperty("--color-accent-text", ink);
  root.setProperty("--color-accent-border", "color-mix(in srgb, " + ink + " 72%, transparent)");
}

export function applyAccent(id: AccentId): void {
  try {
    storage()?.setItem(ACCENT_KEY, id);
  } catch {
  }
  paintAccent(id);
  for (const listener of listeners) listener();
}

export function repaintAccent(): void {
  paintAccent(readAccent());
}

/** Boot paints the saved accent without rewriting storage, so an unset preference stays unset. */
export function bootAccent(): void {
  paintAccent(readAccent());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const stopSkin = listeners.size === 1 ? subscribeSkin(repaintAccent) : () => {};
  return () => {
    listeners.delete(listener);
    stopSkin();
  };
}

export function useAccent(): AccentId {
  return useSyncExternalStore(subscribe, readAccent, readAccent);
}
