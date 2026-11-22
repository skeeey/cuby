import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export type AppViewEvent = {
  viewId: string;
  appId: string;
  resourceUri: string;
  toolCallId?: string;
  toolName: string;
  title: string;
  displayMode: "inline";
  protocol: "mcp-apps/2026-01-26";
  arguments: Record<string, unknown>;
  prefersBorder?: boolean;
  initialResult: { content: unknown[]; structuredContent?: unknown };
  artifacts?: Array<{ path: string; mimeType: string }>;
  resultRef?: string;
};

const MAX_INLINE_RESULT_BYTES = 256 * 1024;

function artifactExtension(mimeType: string): string {
  switch (mimeType) {
    case "image/png": return "png";
    case "image/jpeg": return "jpg";
    case "image/gif": return "gif";
    case "image/webp": return "webp";
    case "image/svg+xml": return "svg";
    default: return "bin";
  }
}

export function readUiResourceUri(meta: unknown): string | null {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const record = meta as Record<string, any>;
  const nested = record.ui && typeof record.ui === "object" ? record.ui.resourceUri : undefined;
  const flat = record["ui/resourceUri"];
  const value = typeof nested === "string" ? nested : typeof flat === "string" ? flat : null;
  return value && value.startsWith("ui://") ? value : null;
}

export class AppViewStore {
  constructor(private readonly appDataDir: string) {}

  async create(input: {
    appId: string;
    resourceUri: string;
    toolName: string;
    title: string;
    toolCallId?: string;
    arguments: Record<string, unknown>;
    result: any;
  }): Promise<AppViewEvent> {
    const viewId = randomUUID();
    const viewDir = path.join(this.appDataDir, "views", viewId);
    const artifacts: Array<{ path: string; mimeType: string }> = [];
    const content: unknown[] = [];
    const rawContent = Array.isArray(input.result?.content) ? input.result.content : [];

    for (const [index, rawBlock] of rawContent.entries()) {
      if (!rawBlock || typeof rawBlock !== "object" || Array.isArray(rawBlock)) {
        content.push(rawBlock);
        continue;
      }
      const block: Record<string, any> = { ...rawBlock };
      delete block._meta;
      if (
        block.type === "image"
        && typeof block.data === "string"
        && typeof block.mimeType === "string"
      ) {
        const artifactPath = path.join(viewDir, "artifacts", `${index}.${artifactExtension(block.mimeType)}`);
        await mkdir(path.dirname(artifactPath), { recursive: true });
        await writeFile(artifactPath, Buffer.from(block.data, "base64"));
        artifacts.push({ path: artifactPath, mimeType: block.mimeType });
        content.push({ type: "text", text: `[image: ${artifactPath}]` });
        continue;
      }
      content.push(block);
    }

    const structuredContent = input.result?.structuredContent;
    const initialResult: { content: unknown[]; structuredContent?: unknown } = {
      content,
      ...(structuredContent !== undefined ? { structuredContent } : {}),
    };

    let visibleResult = initialResult;
    let resultRef: string | undefined;
    if (JSON.stringify(initialResult).length > MAX_INLINE_RESULT_BYTES) {
      await mkdir(viewDir, { recursive: true });
      const resultPath = path.join(viewDir, "result.json");
      await writeFile(resultPath, JSON.stringify(initialResult));
      resultRef = resultPath;
      visibleResult = {
        content: [{ type: "text", text: "[result too large to inline; available through resultRef]" }],
        structuredContent: { truncated: true },
      };
    }

    return {
      viewId,
      appId: input.appId,
      resourceUri: input.resourceUri,
      ...(input.toolCallId ? { toolCallId: input.toolCallId } : {}),
      toolName: input.toolName,
      title: input.title,
      displayMode: "inline",
      protocol: "mcp-apps/2026-01-26",
      arguments: input.arguments ?? {},
      prefersBorder: true,
      initialResult: visibleResult,
      ...(artifacts.length ? { artifacts } : {}),
      ...(resultRef ? { resultRef } : {}),
    };
  }
}
