import { useEffect, useRef, useState } from "react";
import type { AgentAppView } from "../state/agent-tool-traces.js";
import { cubyHostContext, detectCubyLocale, detectCubyTheme } from "./app-theme.js";
import { AppViewBridge } from "./app-view-bridge.js";
import type { AppBridgeTransport } from "./app-view-types.js";
import { AppViewFrame } from "./app-view-frame.js";

function hostContextFor(displayMode: "inline" | "fullscreen"): Record<string, unknown> {
  return cubyHostContext({
    displayMode,
    container: { width: 800, maxHeight: 640 },
    locale: detectCubyLocale(),
    theme: detectCubyTheme(),
  });
}

export function AppViewHost(props: {
  view: AgentAppView;
  chatId: string;
  client: AppBridgeTransport;
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
        setFrame({ html, view: { ...props.view, initialResult } });
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [props.view.viewId, props.view.resourceUri, props.view.resultRef, props.view.appId, reloadKey]);

  useEffect(() => {
    if (!frame) return;
    const iframe = iframeRef.current;
    if (!iframe) return;
    const bridge = new AppViewBridge({
      iframe,
      view: frame.view,
      hostContext: () => hostContextFor(displayModeRef.current),
      transport: props.client,
      onDisplayModeChange: (mode) => setDisplayMode(mode),
      onSizeChange: (size) => {
        if (typeof size.height === "number" && size.height > 0) setHeight(size.height);
      },
      onError: (message) => setError(message),
    });
    bridgeRef.current = bridge;
    bridge.start();
    return () => {
      bridgeRef.current = null;
      void bridge.teardown();
    };
  }, [frame, props.client]);

  useEffect(() => {
    if (!frame) return;
    bridgeRef.current?.sendHostContextChanged(hostContextFor(displayMode));
  }, [displayMode, frame]);

  const expanded = displayMode === "fullscreen";

  return (
    <AppViewFrame
      view={props.view}
      state={error ? "error" : frame ? "ready" : "loading"}
      error={error ?? undefined}
      onRetry={() => {
        setError(null);
        setFrame(null);
        setReloadKey((value) => value + 1);
      }}
      onToggleExpanded={() => setDisplayMode(expanded ? "inline" : "fullscreen")}
      expanded={expanded}
    >
      {frame ? (
        <iframe
          ref={iframeRef}
          srcDoc={frame.html}
          sandbox="allow-scripts"
          title={props.view.title}
          className="cuby-app-view__iframe"
          style={{ width: "100%", height, border: 0 }}
        />
      ) : null}
    </AppViewFrame>
  );
}
