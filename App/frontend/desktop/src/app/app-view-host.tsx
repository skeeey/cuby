import { useEffect, useRef, useState } from "react";
import type { AgentAppView } from "../state/agent-tool-traces.js";
import { AppViewBridge } from "./app-view-bridge.js";
import type { AppBridgeTransport } from "./app-view-types.js";

export function AppViewHost(props: {
  view: AgentAppView;
  chatId: string;
  client: AppBridgeTransport;
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [frame, setFrame] = useState<{ html: string; view: AgentAppView } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setFrame(null);
    setError(null);

    (async () => {
      try {
        const resource = await props.client.readResource({
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
          const restored = await props.client.readViewResult(props.view.viewId);
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
  }, [props.view.viewId, props.view.resourceUri, props.view.resultRef]);

  useEffect(() => {
    if (!frame) return;
    const iframe = iframeRef.current;
    if (!iframe) return;
    const bridge = new AppViewBridge({
      iframe,
      view: frame.view,
      hostContext: () => ({}),
      transport: props.client,
    });
    bridge.start();
    return () => {
      void bridge.teardown();
    };
  }, [frame, props.client]);

  if (error) {
    return <div className="cuby-app-view cuby-app-view--error">{error}</div>;
  }

  return (
    <div className="cuby-app-view">
      {frame ? (
        <iframe
          ref={iframeRef}
          srcDoc={frame.html}
          sandbox="allow-scripts"
          title={props.view.title}
          className="cuby-app-view__iframe"
          style={{ width: "100%", height: 320, border: 0 }}
        />
      ) : (
        <div className="cuby-app-view__loading">正在载入 app…</div>
      )}
    </div>
  );
}
