import type { AgentAppView, AppBridgeTransport } from "./app-view-types.js";

const PROTOCOL_VERSION = "2026-01-26";
const INIT_TIMEOUT_MS = 5000;

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => (
      block && typeof block === "object" && (block as any).type === "text"
        && typeof (block as any).text === "string"
        ? (block as any).text
        : ""
    ))
    .filter(Boolean)
    .join("\n")
    .trim();
}

type JsonRpcMessage = {
  jsonrpc?: string;
  id?: unknown;
  method?: string;
  params?: any;
  result?: any;
  error?: any;
};

export class AppViewBridge {
  readonly iframeWindow: { postMessage(message: unknown, targetOrigin: string): void } | null;
  private readonly view: AgentAppView;
  private readonly hostContext: () => Record<string, unknown>;
  private readonly transport: AppBridgeTransport;
  private readonly openLink?: (url: string) => Promise<void>;
  private readonly downloadFile?: (contents: unknown[]) => Promise<any>;
  private readonly onDisplayModeChange?: (mode: "inline" | "fullscreen") => void;
  private readonly onSizeChange?: (size: { width?: number; height?: number }) => void;
  private readonly onError?: (message: string) => void;
  private readonly layout: "inline" | "page";
  private readonly onOpenChat?: (input: { message?: string }) => Promise<void>;
  private listening = false;
  private initialized = false;
  private initTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly onWindowMessage = (event: MessageEvent): void => {
    void this.handleMessage(event);
  };

  constructor(input: {
    iframe: { contentWindow: { postMessage(message: unknown, targetOrigin: string): void } | null };
    view: AgentAppView;
    hostContext: () => Record<string, unknown>;
    transport: AppBridgeTransport;
    openLink?: (url: string) => Promise<void>;
    downloadFile?: (contents: unknown[]) => Promise<any>;
    onDisplayModeChange?: (mode: "inline" | "fullscreen") => void;
    onSizeChange?: (size: { width?: number; height?: number }) => void;
    onError?: (message: string) => void;
    layout?: "inline" | "page";
    onOpenChat?: (input: { message?: string }) => Promise<void>;
  }) {
    this.iframeWindow = input.iframe.contentWindow;
    this.view = input.view;
    this.hostContext = input.hostContext;
    this.transport = input.transport;
    this.openLink = input.openLink;
    this.downloadFile = input.downloadFile;
    this.onDisplayModeChange = input.onDisplayModeChange;
    this.onSizeChange = input.onSizeChange;
    this.onError = input.onError;
    this.layout = input.layout ?? "inline";
    this.onOpenChat = input.onOpenChat;
  }

  start(): void {
    if (this.listening) return;
    this.listening = true;
    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      window.addEventListener("message", this.onWindowMessage);
    }
    this.initTimer = setTimeout(() => {
      if (!this.initialized) this.onError?.("MCP app did not initialize within 5s");
    }, INIT_TIMEOUT_MS);
    this.initTimer.unref?.();
  }

  async handleMessage(event: { source?: unknown; data?: unknown }): Promise<void> {
    if (event.source !== this.iframeWindow) return;
    const message = event.data as JsonRpcMessage;
    if (!message || typeof message !== "object" || message.jsonrpc !== "2.0") return;
    if (message.id !== undefined && typeof message.method === "string") {
      await this.handleRequest(message);
      return;
    }
    if (typeof message.method === "string") {
      this.handleNotification(message);
    }
  }

  sendToolInput(args: Record<string, unknown>): void {
    this.post({
      jsonrpc: "2.0",
      method: "ui/notifications/tool-input",
      params: { arguments: args },
    });
  }

  sendToolResult(result: unknown): void {
    this.post({
      jsonrpc: "2.0",
      method: "ui/notifications/tool-result",
      params: result,
    });
  }

  sendHostContextChanged(context: Record<string, unknown>): void {
    this.post({
      jsonrpc: "2.0",
      method: "ui/notifications/host-context-changed",
      params: context,
    });
  }

  async teardown(): Promise<void> {
    this.post({
      jsonrpc: "2.0",
      method: "ui/resource-teardown",
      params: {},
    });
    this.stopListening();
  }

  private async handleRequest(message: JsonRpcMessage): Promise<void> {
    const method = message.method;
    try {
      switch (method) {
        case "ui/initialize":
          this.respond(message.id, {
            protocolVersion: PROTOCOL_VERSION,
            hostInfo: { name: "Cuby", version: "0.0.0" },
            hostCapabilities: {
              ...(this.openLink ? { openLinks: {} } : {}),
              ...(this.downloadFile ? { downloadFile: {} } : {}),
              ...(this.onOpenChat ? { chatPanel: {} } : {}),
              serverTools: {},
              serverResources: {},
            },
            hostContext: this.hostContext(),
          });
          return;
        case "tools/call": {
          const params = message.params ?? {};
          const result = await this.transport.callTool({
            appId: this.view.appId,
            viewId: this.view.viewId,
            tool: String(params.name ?? ""),
            arguments: params.arguments ?? {},
            timeoutMs: (this.view.toolTimeout ?? 30) * 1000,
          });
          this.respond(message.id, result);
          return;
        }
        case "resources/read": {
          const params = message.params ?? {};
          const result = await this.transport.readResource({
            appId: this.view.appId,
            viewId: this.view.viewId,
            uri: String(params.uri ?? ""),
            timeoutMs: (this.view.toolTimeout ?? 30) * 1000,
          });
          this.respond(message.id, result);
          return;
        }
        case "ui/message": {
          const params = message.params ?? {};
          if (this.layout === "page") {
            if (this.view.capabilities?.appMessages !== "allow") {
              throw new Error("chat panel is not allowed");
            }
            if (!this.onOpenChat) throw new Error("chat panel is unavailable");
            const text = textFromContent(params.content);
            if (!text) throw new Error("ui/message requires text content");
            await this.onOpenChat({ message: text });
            this.respond(message.id, {});
            return;
          }
          const result = await this.transport.sendMessage({
            appId: this.view.appId,
            viewId: this.view.viewId,
            content: Array.isArray(params.content) ? params.content : [],
          });
          this.respond(message.id, result ?? {});
          return;
        }
        case "ui/open-chat": {
          if (this.view.capabilities?.appMessages !== "allow") {
            throw new Error("chat panel is not allowed");
          }
          if (!this.onOpenChat) throw new Error("chat panel is unavailable");
          const messageText = typeof message.params?.message === "string"
            ? message.params.message.trim()
            : "";
          await this.onOpenChat(messageText ? { message: messageText } : {});
          this.respond(message.id, {});
          return;
        }
        case "ui/open-link": {
          const url = String(message.params?.url ?? "");
          if (!/^https?:\/\//i.test(url) || !this.openLink) {
            throw new Error("open-link is not allowed");
          }
          await this.openLink(url);
          this.respond(message.id, {});
          return;
        }
        case "ui/download-file": {
          if (!this.downloadFile) throw new Error("download-file is not allowed");
          await this.downloadFile(
            Array.isArray(message.params?.contents) ? message.params.contents : [],
          );
          this.respond(message.id, {});
          return;
        }
        case "ui/request-display-mode": {
          if (this.layout === "page") {
            this.respond(message.id, { mode: "fullscreen" });
            return;
          }
          const mode = message.params?.mode;
          if (mode !== "inline" && mode !== "fullscreen") {
            throw new Error("unsupported display mode");
          }
          this.onDisplayModeChange?.(mode);
          this.respond(message.id, { mode });
          return;
        }
        case "ui/update-model-context":
          this.respond(message.id, {});
          return;
        default:
          this.respondError(message.id, -32601, `Unknown method: ${String(method)}`);
      }
    } catch (error) {
      this.respondError(
        message.id,
        -32603,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private handleNotification(message: JsonRpcMessage): void {
    switch (message.method) {
      case "ui/notifications/initialized":
        this.initialized = true;
        if (this.initTimer) {
          clearTimeout(this.initTimer);
          this.initTimer = null;
        }
        this.sendToolInput((this.view.arguments ?? {}) as Record<string, unknown>);
        this.sendToolResult(this.view.initialResult ?? { content: [] });
        return;
      case "ui/notifications/size-changed":
        this.onSizeChange?.({
          ...(typeof message.params?.width === "number" ? { width: message.params.width } : {}),
          ...(typeof message.params?.height === "number" ? { height: message.params.height } : {}),
        });
        return;
      case "ui/notifications/request-teardown":
        void this.teardown();
        return;
      default:
        return;
    }
  }

  private respond(id: unknown, result: unknown): void {
    this.post({ jsonrpc: "2.0", id, result });
  }

  private respondError(id: unknown, code: number, message: string): void {
    this.post({ jsonrpc: "2.0", id, error: { code, message } });
  }

  private post(message: unknown): void {
    this.iframeWindow?.postMessage(message, "*");
  }

  private stopListening(): void {
    if (!this.listening) return;
    this.listening = false;
    if (this.initTimer) {
      clearTimeout(this.initTimer);
      this.initTimer = null;
    }
    if (typeof window !== "undefined" && typeof window.removeEventListener === "function") {
      window.removeEventListener("message", this.onWindowMessage);
    }
  }
}
