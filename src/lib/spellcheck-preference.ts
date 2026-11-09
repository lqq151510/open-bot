import { useSyncExternalStore } from "react";

export const SPELLCHECK_KEY = "omb-spellcheck";

let sessionChoice: boolean | undefined;
const listeners = new Set<() => void>();

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function readSpellcheck(): boolean {
  if (sessionChoice !== undefined) return sessionChoice;
  try {
    return storage()?.getItem(SPELLCHECK_KEY) !== "0";
  } catch {
    return true;
  }
}

function notify() {
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent) {
  if (event.key !== SPELLCHECK_KEY && event.key !== null) return;
  if (event.storageArea && event.storageArea !== storage()) return;
  sessionChoice = undefined;
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

export function setSpellcheck(enabled: boolean): void {
  sessionChoice = enabled;
  try {
    storage()?.setItem(SPELLCHECK_KEY, enabled ? "1" : "0");
  } catch {
  }
  notify();
}

export function useSpellcheck(): boolean {
  return useSyncExternalStore(subscribe, readSpellcheck, readSpellcheck);
}
