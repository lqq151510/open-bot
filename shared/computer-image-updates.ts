export type ComputerImageStatus = "current" | "ready" | "busy" | "waiting";

export interface ComputerImageUpdate {
  id: string;
  name: string;
  provider: "local-vm" | "vps" | "boat";
  status: ComputerImageStatus;
}

export interface ComputerImageUpdates {
  status: ComputerImageStatus | "unavailable";
  computers: ComputerImageUpdate[];
  unverified: boolean;
}
