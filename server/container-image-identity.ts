export const CUA_DRIVER_VERSION = "0.37.0";
export const BASE_IMAGE_REPOSITORY = "docker.io/trycua/xfce-cua";
// Official multi-architecture Cua XFCE 0.1.0 manifest (amd64 + arm64).
export const BASE_IMAGE_DIGEST = "sha256:274eb636f5cf3fc58f705916ee72b7a701270b3877369d08533a385c5325be9b";
export const BASE_IMAGE = `${BASE_IMAGE_REPOSITORY}@${BASE_IMAGE_DIGEST}`;
// Podman prefixes local build tags with localhost/ and can resolve other names remotely.
export const IMAGE_REPOSITORY = "localhost/openbot/cua-local-vm";
export const IMAGE_LAYER_VERSION = "8";
export const IMAGE_LAYER_LABEL = "com.openbot.image-layer";
export const IMAGE = `${IMAGE_REPOSITORY}:driver-${CUA_DRIVER_VERSION}-v${IMAGE_LAYER_VERSION}`;
export const MANAGED_LABEL = "com.openbot.local-vm";
export const DRIVER_LABEL = "com.openbot.cua-driver";
export const BASE_IMAGE_LABEL = "com.openbot.cua-base";

export const VPS_VIEWER_LABEL = "com.openbot.vps-viewer";
export const VPS_VIEWER_VERSION = "1";
export const VPS_IMAGE_ID = /^sha256:[a-f0-9]{64}$/i;

export function imagePinDiffers(reference: unknown, labels: Record<string, unknown> | undefined): boolean {
  return (typeof reference === "string" && reference.startsWith(`${IMAGE_REPOSITORY}:driver-`) && reference !== IMAGE) ||
    (typeof labels?.[DRIVER_LABEL] === "string" && labels[DRIVER_LABEL] !== CUA_DRIVER_VERSION) ||
    (typeof labels?.[BASE_IMAGE_LABEL] === "string" && labels[BASE_IMAGE_LABEL] !== BASE_IMAGE_DIGEST) ||
    (typeof labels?.[IMAGE_LAYER_LABEL] === "string" && labels[IMAGE_LAYER_LABEL] !== IMAGE_LAYER_VERSION);
}

export function imageLabelsMatch(labels: Record<string, unknown> | undefined): boolean {
  return (
    labels?.[MANAGED_LABEL] === "1" &&
    labels?.[DRIVER_LABEL] === CUA_DRIVER_VERSION &&
    labels?.[BASE_IMAGE_LABEL] === BASE_IMAGE_DIGEST &&
    labels?.[IMAGE_LAYER_LABEL] === IMAGE_LAYER_VERSION
  );
}

export function normalizeImageId(id: string | undefined): string | null {
  return id?.trim().replace(/^sha256:/, "") || null;
}

interface ImageInspection {
  Id?: string;
  id?: string;
  Config?: { Labels?: Record<string, string> };
  config?: { Labels?: Record<string, string>; labels?: Record<string, string> };
  configuration?: { labels?: Record<string, string>; descriptor?: { digest?: string } };
  variants?: Array<{
    platform?: { os?: string; architecture?: string };
    config?: { config?: { Labels?: Record<string, string> } };
  }>;
}

function dockerImageLabels(image: ImageInspection | undefined): Record<string, string> | undefined {
  return image?.Config?.Labels ?? image?.config?.Labels ?? image?.config?.labels;
}

export function inspectedImage(stdout: string, runtime: "docker" | "podman" | "container"): {
  labels: Record<string, string> | undefined;
  id: string | null;
} {
  const parsed = JSON.parse(stdout) as ImageInspection[];
  const image = parsed[0];
  // Apple container puts image labels inside each platform variant.
  const variants = runtime === "container" && Array.isArray(image?.variants)
    ? image.variants.filter(variant => variant?.platform?.os === "linux" && variant.platform.architecture === "arm64")
    : [];
  return {
    labels: runtime === "container"
      ? (variants.length === 1 ? variants[0]?.config?.config?.Labels : undefined)
      : dockerImageLabels(image) ?? image?.configuration?.labels,
    id: normalizeImageId(image?.Id ?? image?.id ?? image?.configuration?.descriptor?.digest),
  };
}

export function vpsImageIdentity(stdout: string): { id: string | null; verified: boolean } {
  const [image] = JSON.parse(stdout) as ImageInspection[];
  const imageId = image?.Id ?? image?.id;
  const id = imageId && VPS_IMAGE_ID.test(imageId) ? imageId : null;
  return { id, verified: id !== null && imageLabelsMatch(dockerImageLabels(image)) };
}

interface VpsContainerImage {
  Config?: { Image?: unknown; Labels?: unknown };
  Image?: unknown;
}

export function vpsImageMatches(detail: VpsContainerImage | undefined, imageId: string): boolean {
  const config = detail?.Config;
  const labels = config?.Labels as Record<string, unknown> | undefined;
  return (config?.Image === IMAGE || config?.Image === imageId) &&
    detail?.Image === imageId && imageLabelsMatch(labels) && labels?.[VPS_VIEWER_LABEL] === VPS_VIEWER_VERSION;
}

export async function inspectVpsBaseline(inspect: () => Promise<{ stdout: string }>): Promise<string | null> {
  try {
    const expected = vpsImageIdentity((await inspect()).stdout);
    return expected.verified ? expected.id : null;
  } catch {
    return null;
  }
}

export function vpsInventoryImageVerdict(detail: VpsContainerImage, baseline: string | null): boolean | null {
  if (typeof detail.Image !== "string" || !VPS_IMAGE_ID.test(detail.Image)) return null;
  if (baseline) return vpsImageMatches(detail, baseline);
  const config = detail.Config;
  return imagePinDiffers(config?.Image, config?.Labels as Record<string, unknown> | undefined) ? false : null;
}
