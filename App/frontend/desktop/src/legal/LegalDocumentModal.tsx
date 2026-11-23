/** Legal document modal module. */
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Modal } from "../components/modal.js";
import { useTranslation } from "../i18n/use-translation.js";
import { openExternalUrl } from "../utils/open-url.js";
import { resolveLegalDocument, type LegalDocumentKind } from "./legal-content.js";

const markdownComponents: Components = {
  a({ href, children }) {
    return (
      <a
        href={href}
        className="legal-document__link"
        onClick={(event) => {
          event.preventDefault();
          if (href) void openExternalUrl(href);
        }}
      >
        {children}
      </a>
    );
  }
};

/** Renders bundled legal Markdown; links leave the renderer through the desktop bridge. */
export function LegalMarkdown(props: { markdown: string }) {
  return (
    <div className="legal-document">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents} skipHtml>
        {props.markdown}
      </ReactMarkdown>
    </div>
  );
}

export interface LegalDocumentModalProps {
  /** Document to show, or null to render nothing. */
  kind: LegalDocumentKind | null;
  /** Closes the overlay. */
  onClose: () => void;
}

/** In-app reader for the bundled service and data agreements. */
export function LegalDocumentModal(props: LegalDocumentModalProps) {
  const { t, language } = useTranslation();
  if (!props.kind) return null;
  return (
    <Modal
      open
      title={t(props.kind === "data" ? "legal.data" : "legal.terms")}
      closeLabel={t("legal.back")}
      onClose={props.onClose}
      className="legal-document-modal"
      bodyClassName="legal-document-modal__body"
    >
      <LegalMarkdown markdown={resolveLegalDocument(props.kind, language)} />
    </Modal>
  );
}
