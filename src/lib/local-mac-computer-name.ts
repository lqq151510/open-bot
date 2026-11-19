import { useEffect, useState } from "react";

export function useLocalMacComputerName(enabled = true): string | null | undefined {
  const bridge = typeof window === "undefined" ? undefined : window.ogb;
  const read = enabled && bridge?.platform === "darwin" && bridge.app?.ownPage === true && bridge.remoteClient?.active !== true
    ? bridge.deviceAccess?.computerName
    : undefined;
  const [name, setName] = useState<string | null>();

  useEffect(() => {
    if (!read) return;
    let active = true;
    void Promise.resolve().then(read).then((value) => {
      if (active) setName(value?.trim() || null);
    }, () => {
      if (active) setName(null);
    });
    return () => { active = false; };
  }, [read]);

  return read ? name : null;
}
