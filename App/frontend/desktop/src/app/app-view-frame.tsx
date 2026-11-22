import { useEffect, type ReactNode } from "react";
import { Maximize2, Minimize2, RotateCw } from "lucide-react";
import type { AgentAppView } from "../state/agent-tool-traces.js";

function LoadingSkeleton() {
  return (
    <div className="cuby-app-view-frame__skeleton space-y-2 p-3" aria-hidden="true">
      {[0, 1, 2].map((row) => (
        <div
          key={row}
          className="h-3 animate-pulse rounded bg-canvas-oat"
          style={{ width: row === 2 ? "60%" : "100%" }}
        />
      ))}
    </div>
  );
}

export function AppViewFrame(props: {
  view: AgentAppView;
  children: ReactNode;
  state: "loading" | "ready" | "error";
  error?: string;
  onRetry?: () => void;
  onToggleExpanded?: () => void;
  expanded: boolean;
}) {
  useEffect(() => {
    if (!props.expanded) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onToggleExpanded?.();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [props.expanded, props.onToggleExpanded]);

  const prefersBorder = props.view.prefersBorder !== false;
  return (
    <section
      className={`cuby-app-view-frame my-2 overflow-hidden${props.expanded ? " cuby-app-view-frame--expanded" : ""}`}
      style={{
        borderRadius: "var(--radius-card)",
        border: prefersBorder ? "1px solid var(--color-border-stone)" : "1px solid transparent",
        background: prefersBorder ? "var(--color-background-paper)" : "transparent",
        ...(props.expanded
          ? { position: "fixed", inset: 0, zIndex: 60, overflow: "auto", padding: "1rem" }
          : {}),
      }}
      aria-label={props.view.title}
      data-app-id={props.view.appId}
    >
      <header
        className="cuby-app-view-frame__header flex items-center gap-2 px-3 py-2"
        style={{ borderBottom: prefersBorder ? "1px solid var(--color-border-stone)" : "none" }}
      >
        <span className="cuby-app-view-frame__app text-[11px] uppercase tracking-wide text-text-ink/45">
          {props.view.appId}
        </span>
        <span className="cuby-app-view-frame__title min-w-0 flex-1 truncate text-[13px] font-medium text-text-ink">
          {props.view.title}
        </span>
        <div className="flex items-center gap-1">
          {props.state === "error" && props.onRetry ? (
            <button
              type="button"
              aria-label="重试"
              title="重试"
              onClick={props.onRetry}
              className="inline-flex h-7 w-7 items-center justify-center rounded-btn text-text-ink/55 hover:bg-canvas-oat"
            >
              <RotateCw size={14} />
            </button>
          ) : null}
          {props.onToggleExpanded ? (
            <button
              type="button"
              aria-label={props.expanded ? "退出全屏" : "全屏"}
              title={props.expanded ? "退出全屏" : "全屏"}
              onClick={props.onToggleExpanded}
              className="inline-flex h-7 w-7 items-center justify-center rounded-btn text-text-ink/55 hover:bg-canvas-oat"
            >
              {props.expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
          ) : null}
        </div>
      </header>
      <div className="cuby-app-view-frame__body">
        {props.state === "loading" ? <LoadingSkeleton /> : null}
        {props.state === "error" ? (
          <div className="cuby-app-view-frame__error px-3 py-4 text-[13px] text-status-error">
            {props.error ?? "app 载入失败"}
          </div>
        ) : null}
        {props.state === "ready" ? props.children : null}
      </div>
    </section>
  );
}
