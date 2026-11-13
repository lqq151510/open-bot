export type LocalPhotosResult =
  | { status: "selected"; photos: Uint8Array[]; skipped: number }
  | { status: "cancelled" | "busy" | "unavailable" };

/** Opens the system picker for the local workspace and returns JPEG copies of the selected photos. */
export interface LocalPhotosBridge {
  pick(limit: number, bytes: number): Promise<LocalPhotosResult>;
}
