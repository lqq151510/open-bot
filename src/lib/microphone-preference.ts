import { useSyncExternalStore } from "react";

export const MICROPHONE_KEY = "omb-microphone";
export const SYSTEM_MICROPHONE = "default";

let sessionChoice: string | undefined;
const listeners = new Set<() => void>();

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function readMicrophone(): string {
  if (sessionChoice !== undefined) return sessionChoice;
  try {
    return storage()?.getItem(MICROPHONE_KEY) || SYSTEM_MICROPHONE;
  } catch {
    return SYSTEM_MICROPHONE;
  }
}

function notify() {
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent) {
  if (event.key !== MICROPHONE_KEY && event.key !== null) return;
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

export function setMicrophone(deviceId: string): void {
  sessionChoice = deviceId;
  try {
    storage()?.setItem(MICROPHONE_KEY, deviceId);
  } catch {
  }
  notify();
}

export function useMicrophone(): string {
  return useSyncExternalStore(subscribe, readMicrophone, readMicrophone);
}

/** The chosen microphone, if any, on top of the echo and noise defaults callers already pass. */
export function withMicrophone(audio: MediaTrackConstraints): MediaTrackConstraints {
  const deviceId = readMicrophone();
  return deviceId === SYSTEM_MICROPHONE ? audio : { ...audio, deviceId: { exact: deviceId } };
}
