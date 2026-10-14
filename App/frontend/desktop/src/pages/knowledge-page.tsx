import { useAppState } from "../state/app-state.js";
import { appActions } from "../state/app-actions.js";
import { canUseCloudFeatures } from "../state/app-reducer.js";
import { KnowledgePage as KnowledgeManagement } from "@memmy/knowledge/ui";
import { useApiClients } from "../app/providers.js";
import { useTranslation } from "../i18n/use-translation.js";
import { AppFrame } from "./app-frame.js";

export function KnowledgePage() {
  const { state, dispatch } = useAppState();
  const { clients } = useApiClients();
  const { language, t } = useTranslation();

  // The knowledge base lives behind the memmy cloud credential, and its own
  // signed-out state offers a "sign in to Memmy" button — a dead end for a
  // cuberouter account that is already signed in. Keep it out of the page.
  if (!canUseCloudFeatures(state)) {
    return (
      <AppFrame title={t("nav.knowledge")}>
        <div className="app-frame-page-content h-full overflow-y-auto py-6">
          <p className="rounded-card border-content-panel bg-background-paper p-4 text-sm text-text-ink/55">
            {t("knowledge.cloudUnavailable")}
          </p>
        </div>
      </AppFrame>
    );
  }

  return (
    <AppFrame title={t("nav.knowledge")}>
      <div className="h-full overflow-y-auto">
        {clients && (
          <KnowledgeManagement
            key={state.account.userId ?? "signed-out"}
            onSignIn={() => dispatch(appActions.navigate("/welcome"))}
            connection={clients.runtimeConfig}
            language={language}
          />
        )}
      </div>
    </AppFrame>
  );
}
