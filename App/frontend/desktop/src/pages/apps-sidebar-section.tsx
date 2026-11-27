import { Puzzle } from "lucide-react";
import type { AppHostSummary } from "@memmy/local-api-contracts";
import { useTranslation } from "../i18n/use-translation.js";

export interface AppsSidebarSectionProps {
  apps: AppHostSummary[];
  activeAppId: string | null;
  loading?: boolean;
  error?: string | null;
  onOpen: (appId: string) => void;
  onRetry: () => void;
}

function statusColor(state: AppHostSummary["state"]): string {
  if (state === "ready") return "var(--color-status-success)";
  if (state === "starting") return "var(--color-status-warning)";
  if (state === "failed" || state === "missing_credentials") return "var(--color-status-error)";
  return "var(--color-text-ink)";
}

export function AppsSidebarSection(props: AppsSidebarSectionProps) {
  const { t } = useTranslation();
  const visibleApps = props.apps.filter((app) => app.hasUi);

  if (props.loading) {
    return (
      <div className="mt-3 px-2" aria-hidden="true">
        <div className="mb-2 h-2.5 w-12 animate-pulse rounded bg-canvas-oat" />
        {[0, 1].map((row) => (
          <div key={row} className="mb-1.5 h-7 animate-pulse rounded bg-canvas-oat" />
        ))}
      </div>
    );
  }

  if (props.error && !visibleApps.length) {
    return (
      <div className="mt-3 px-2 text-xs text-status-error">
        <div className="mb-1 flex items-center gap-2">
          <span className="min-w-0 flex-1 break-words">{props.error}</span>
          <button
            type="button"
            data-apps-retry
            className="shrink-0 rounded-btn px-2 py-1 hover:bg-canvas-oat"
            onClick={props.onRetry}
          >
            {t("appFrame.apps.retry")}
          </button>
        </div>
        <div className="text-text-ink/45">{t("appFrame.apps.loadFailed")}</div>
      </div>
    );
  }

  if (!visibleApps.length) {
    return null;
  }

  return (
    <div className="mt-3 px-1">
      <div className="mb-1 px-2 text-[11px] uppercase tracking-wide text-text-ink/45">
        {t("appFrame.apps.title")}
      </div>
      {props.error ? (
        <div className="mb-1 flex items-center gap-2 px-2 text-xs text-status-error">
          <span className="min-w-0 flex-1 break-words">{props.error}</span>
          <button
            type="button"
            data-apps-retry
            className="shrink-0 rounded-btn px-2 py-1 hover:bg-canvas-oat"
            onClick={props.onRetry}
          >
            {t("appFrame.apps.retry")}
          </button>
        </div>
      ) : null}
      <div className="space-y-1">
        {visibleApps.map((app) => {
          const disabled = app.state === "disabled";
          const active = app.id === props.activeAppId;
          return (
            <button
              key={app.id}
              type="button"
              data-app-id={app.id}
              disabled={disabled}
              title={app.error ?? undefined}
              aria-current={active ? "page" : undefined}
              onClick={() => props.onOpen(app.id)}
              className={`app-frame-nav-button relative flex w-full items-center gap-2 transition-all ${
                disabled
                  ? "cursor-not-allowed opacity-45"
                  : active
                    ? "app-frame-nav-button--active"
                    : "cursor-pointer text-text-ink/75 hover:bg-canvas-oat/60 hover:text-text-ink/85"
              }`}
            >
              <span className="shrink-0"><Puzzle size={16} /></span>
              <span className="min-w-0 flex-1 truncate text-left">{app.name}</span>
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{
                  backgroundColor: statusColor(app.state),
                  opacity: app.state === "disabled" ? 0.35 : 1
                }}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
