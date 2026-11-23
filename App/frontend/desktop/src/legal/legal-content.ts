import type { ResolvedLanguage } from "../i18n/messages.js";
import termsZhCN from "./content/user-agreement.zh-CN.md?raw";
import termsEnUS from "./content/user-agreement.en-US.md?raw";
import dataZhCN from "./content/data-agreement.zh-CN.md?raw";
import dataEnUS from "./content/data-agreement.en-US.md?raw";

export type LegalDocumentKind = "terms" | "data";

const documents: Record<LegalDocumentKind, Record<ResolvedLanguage, string>> = {
  terms: { "zh-CN": termsZhCN, "en-US": termsEnUS },
  data: { "zh-CN": dataZhCN, "en-US": dataEnUS }
};

/** Returns the bundled legal document for a kind and UI language. */
export function resolveLegalDocument(kind: LegalDocumentKind, language: ResolvedLanguage): string {
  return documents[kind][language];
}
