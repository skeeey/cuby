import path from "node:path";

export const MAX_APP_DOWNLOAD_BYTES = 128 * 1024 * 1024;

export type DecodedAppDownload = {
  name: string;
  mime: string;
  data: Uint8Array;
};

export function sanitizeAppFileName(name: string): string {
  const base = path.basename(typeof name === "string" && name.trim() ? name : "download");
  const safe = base.replace(/[^A-Za-z0-9._ -]/g, "_").trim();
  return safe && safe !== "." && safe !== ".." ? safe : "download";
}

function fileNameFromUri(uri: string): string | null {
  try {
    const parsed = new URL(uri);
    const fromPath = path.basename(decodeURIComponent(parsed.pathname));
    if (fromPath) return fromPath;
    const fromHost = path.basename(parsed.hostname);
    return fromHost || null;
  } catch {
    return null;
  }
}

export function decodeAppDownloadContents(contents: unknown): DecodedAppDownload[] {
  if (!Array.isArray(contents) || !contents.length) {
    throw new Error("download requires at least one resource");
  }

  return contents.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`invalid download content at ${index}`);
    }
    const record = item as Record<string, any>;
    if (record.type !== "resource" || !record.resource || typeof record.resource !== "object") {
      throw new Error(`unsupported download content at ${index}; only embedded resources are allowed`);
    }
    const resource = record.resource as Record<string, any>;
    if (typeof resource.blob !== "string") {
      throw new Error(`resource link at ${index} must be resolved by the host before saving`);
    }
    const mime = typeof resource.mimeType === "string" && resource.mimeType
      ? resource.mimeType
      : "application/octet-stream";
    const name = (typeof resource.uri === "string" ? fileNameFromUri(resource.uri) : null)
      ?? `download-${index + 1}.bin`;
    const data = new Uint8Array(Buffer.from(resource.blob, "base64"));
    if (data.byteLength > MAX_APP_DOWNLOAD_BYTES) {
      throw new Error(`download content at ${index} is too large`);
    }
    return { name: sanitizeAppFileName(name), mime, data };
  });
}
