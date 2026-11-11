export type DeviceExecution = "always" | "ask" | "never";

export interface DeviceAccessState {
  execution: DeviceExecution;
  forwardTraffic: boolean;
}

export type DeviceAccessPatch = Partial<DeviceAccessState>;
