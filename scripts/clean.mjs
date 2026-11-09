import { rm } from "node:fs/promises";
import { removeAppleDoubleFiles } from "./clean-apple-double.mjs";

const generatedPaths = [
  "dist",
  "dist-electron",
  "dist-native",
  "dist-server",
  "release",
  "electron/resources/speech-helper",
  "electron/resources/OpenBot Speech.app",
];

await Promise.all([
  ...generatedPaths.map((path) => rm(path, { recursive: true, force: true })),
  removeAppleDoubleFiles(process.cwd()),
]);

