import { useEffect, useRef, useState } from "react";
import type { AgentAppView } from "../state/agent-tool-traces.js";
import { cubyHostContext, detectCubyLocale, detectCubyTheme, injectAppCsp, watchCubyTheme } from "./app-theme.js";
import { AppViewBridge } from "./app-view-bridge.js";
import type { AppBridgeTransport } from "./app-view-types.js";
import { AppViewFrame } from "./app-view-frame.js";

function hostContextFor(
  displayMode: "inline" | "fullscreen",
  layout: "inline" | "page" = "inline",
): Record<string, unknown> {
  const page = layout === "page";
  return cubyHostContext({
    displayMode: page ? "fullscreen" : displayMode,
    container: page
      ? {
          width: typeof window !== "undefined" ? window.innerWidth : 1200,
          height: typeof window !== "undefined" ? window.innerHeight : 800,
        }
      : { width: 800, maxHeight: 640 },
    locale: detectCubyLocale(),
    theme: detectCubyTheme(),
  });
}

function decodeDownloadItem(item: any): { name: string; mime: string; data: Uint8Array } {
  const resource = item?.type === "resource" ? item.resource : null;
  if (!resource || typeof resource.blob !== "string") {
    throw new Error("unsupported download content");
  }
  const mime = typeof resource.mimeType === "string" ? resource.mimeType : "application/octet-stream";
  const uri = typeof resource.uri === "string" ? resource.uri : "";
  const baseName = uri ? decodeURIComponent(uri.split("/").pop() || "download") : "download";
  const binary = atob(resource.blob);
  const data = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    data[index] = binary.charCodeAt(index);
  }
  return { name: baseName, mime, data };
}

export function AppViewHost(props: {
  view: AgentAppView;
  chatId: string;
  client: AppBridgeTransport;
  layout?: "inline" | "page";
  onOpenPage?: () => void;
  onOpenChat?: (input: { message?: string }) => Promise<void>;
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const bridgeRef = useRef<AppViewBridge | null>(null);
  const [frame, setFrame] = useState<{ html: string; view: AgentAppView } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [displayMode, setDisplayMode] = useState<"inline" | "fullscreen">("inline");
  const [height, setHeight] = useState(320);
  const displayModeRef = useRef(displayMode);
  displayModeRef.current = displayMode;

  useEffect(() => {
    let cancelled = false;
    setFrame(null);
    setError(null);

    (async () => {
      try {
        const resource = await props.client.readResource({
          appId: props.view.appId,
          viewId: props.view.viewId,
          uri: props.view.resourceUri,
        });
        const contents = Array.isArray(resource?.contents) ? resource.contents : [];
        const html = contents.find((item: any) => typeof item?.text === "string")?.text;
        if (typeof html !== "string") {
          throw new Error("App resource has no HTML content");
        }

        let initialResult = props.view.initialResult ?? { content: [] };
        if (props.view.resultRef) {
          const restored = await props.client.readViewResult({
            appId: props.view.appId,
            viewId: props.view.viewId,
          });
          if (restored) initialResult = restored;
        }
        if (cancelled) return;
        setFrame({ html: injectAppCsp(html, props.view.csp), view: { ...props.view, initialResult } });
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [props.view.viewId, props.view.resourceUri, props.view.resultRef, props.view.appId, props.view.initialResult, props.client, reloadKey]);

  useEffect(() => {
    if (!frame) return;
    const iframe = iframeRef.current;
    if (!iframe) return;
    const capabilities = props.view.capabilities;
    const openLink = capabilities?.openLinks === true
      ? async (url: string) => {
          if (typeof window === "undefined" || !window.memmy?.openExternal) {
            throw new Error("open-link is unavailable");
          }
          if (typeof window.confirm === "function" && !window.confirm(`Open ${url}?`)) {
            throw new Error("open-link cancelled");
          }
          await window.memmy.openExternal(url);
        }
      : undefined;
    const downloadFile = capabilities?.downloads === true
      ? async (contents: unknown[]) => {
          if (typeof window === "undefined" || !window.memmy?.saveAppFile) {
            throw new Error("file save is unavailable");
          }
          const resolved: unknown[] = [];
          for (const item of contents) {
            if (
              item && typeof item === "object"
              && (item as any).type === "resource_link"
              && typeof (item as any).uri === "string"
            ) {
              const resource = await props.client.readResource({
                appId: props.view.appId,
                viewId: props.view.viewId,
                uri: (item as any).uri,
              });
              const resourceContents = Array.isArray(resource?.contents) ? resource.contents : [];
              for (const entry of resourceContents) {
                resolved.push({ type: "resource", resource: entry });
              }
            } else {
              resolved.push(item);
            }
          }
          for (const item of resolved) {
            await window.memmy.saveAppFile(decodeDownloadItem(item));
          }
          return {};
        }
      : undefined;
    const bridge = new AppViewBridge({
      iframe,
      view: frame.view,
      hostContext: () => hostContextFor(displayModeRef.current, props.layout ?? "inline"),
      transport: props.client,
      layout: props.layout ?? "inline",
      onOpenChat: props.onOpenChat,
      onDisplayModeChange: (mode) => setDisplayMode(mode),
      onSizeChange: (size) => {
        if (typeof size.height === "number" && size.height > 0) setHeight(size.height);
      },
      onError: (message) => setError(message),
      ...(openLink ? { openLink } : {}),
      ...(downloadFile ? { downloadFile } : {}),
    });
    bridgeRef.current = bridge;
    bridge.start();
    return () => {
      bridgeRef.current = null;
      void bridge.teardown();
    };
  }, [frame, props.client, props.view.appId, props.view.viewId, props.view.capabilities, props.layout, props.onOpenChat]);

  useEffect(() => {
    if (!frame) return;
    bridgeRef.current?.sendHostContextChanged(hostContextFor(displayMode, props.layout ?? "inline"));
  }, [displayMode, frame, props.layout]);

  useEffect(() => {
    if (!frame) return;
    return watchCubyTheme(() => {
      bridgeRef.current?.sendHostContextChanged(hostContextFor(displayModeRef.current, props.layout ?? "inline"));
    });
  }, [frame, props.layout]);

  const expanded = displayMode === "fullscreen";
  const page = props.layout === "page";

  return (
    <div className={`cuby-app-view-host${page ? " cuby-app-view-host--page h-full min-h-0 w-full" : ""}`}>
      <AppViewFrame
        view={props.view}
        state={error ? "error" : frame ? "ready" : "loading"}
        error={error ?? undefined}
        onRetry={() => {
          setError(null);
          setFrame(null);
          setReloadKey((value) => value + 1);
        }}
        onToggleExpanded={page ? undefined : () => setDisplayMode(expanded ? "inline" : "fullscreen")}
        expanded={page ? false : expanded}
        variant={page ? "page" : "inline"}
        onOpenPage={page ? undefined : props.onOpenPage}
      >
        {frame ? (
          <iframe
            ref={iframeRef}
            srcDoc={frame.html}
            sandbox="allow-scripts"
            title={props.view.title}
            className="cuby-app-view__iframe"
            style={page
              ? { width: "100%", height: "100%", border: 0 }
              : { width: "100%", height, border: 0 }}
          />
        ) : null}
      </AppViewFrame>
    </div>
  );
}
