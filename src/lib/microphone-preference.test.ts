// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { MICROPHONE_KEY, SYSTEM_MICROPHONE, readMicrophone, setMicrophone, withMicrophone } from "./microphone-preference";

describe("microphone preference", () => {
  it("starts on the system default and leaves the constraints alone", () => {
    localStorage.clear();
    expect(readMicrophone()).toBe(SYSTEM_MICROPHONE);
    expect(withMicrophone({ echoCancellation: true })).toEqual({ echoCancellation: true });
  });

  it("pins the chosen device onto the constraints", () => {
    setMicrophone("mic-2");
    expect(localStorage.getItem(MICROPHONE_KEY)).toBe("mic-2");
    expect(withMicrophone({ echoCancellation: true })).toEqual({ echoCancellation: true, deviceId: { exact: "mic-2" } });
  });
});
