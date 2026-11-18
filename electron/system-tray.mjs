import nativeText from "./native-text.cjs";

const tr = (t, key, fallback) => {
  const value = typeof t === "function" ? t(key) : key;
  return !value || value === key ? fallback : value;
};

// Retain the Windows notification-area identity across app restarts.
export function createSystemTray({
  Tray,
  Menu,
  nativeImage,
  iconPath,
  getWindow,
  onQuit,
  onQuickAsk,
  onInterruptLocal,
  isLocalBusy,
  getAccelerator,
  platform = process.platform,
  t = nativeText.englishText.t,
}) {
  const tray = new Tray(nativeImage.createFromPath(iconPath).resize({ width: 20, height: 20 }),
    "889af657-21b5-4ec9-b5d0-cb798cbdfd30");
  let hidden = false;
  const show = () => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return false;
    hidden = false;
    win.setSkipTaskbar?.(false);
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    return true;
  };
  const buildTemplate = () => {
    if (!onQuickAsk && !onInterruptLocal) {
      return [
        { label: t("native.tray.open"), click: show },
        { type: "separator" },
        { label: t("native.tray.quit"), click: onQuit },
      ];
    }
    const busy = Boolean(isLocalBusy?.());
    const accelerator = getAccelerator?.() || undefined;
    return [
      ...(busy ? [
        { label: tr(t, "native.tray.localWorking", "Working on this computer"), enabled: false },
        ...(onInterruptLocal ? [{ label: tr(t, "native.tray.interruptLocal", "Pause computer actions"), click: onInterruptLocal }] : []),
        { type: "separator" },
      ] : []),
      ...(onQuickAsk ? [{
        label: tr(t, "native.tray.quickAsk", "Quick ask…"),
        ...(accelerator ? { accelerator } : {}),
        click: onQuickAsk,
      }] : []),
      { label: t("native.tray.open"), click: show },
      { type: "separator" },
      { label: t("native.tray.quit"), click: onQuit },
    ];
  };
  const label = () => tray.setContextMenu(Menu.buildFromTemplate(buildTemplate()));
  tray.setToolTip("OpenBot");
  label();
  if (platform !== "darwin") {
    tray.on?.("click", show);
    tray.on?.("double-click", show);
  }
  return {
    show,
    hide(win) { hidden = true; win.setSkipTaskbar?.(true); win.hide(); },
    isHidden() { return hidden; },
    windowShown(win) { hidden = false; win.setSkipTaskbar?.(false); },
    relabel() { if (!tray.isDestroyed()) label(); },
    destroy() { if (!tray.isDestroyed()) tray.destroy(); },
  };
}
