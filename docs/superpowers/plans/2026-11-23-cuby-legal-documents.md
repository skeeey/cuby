# Cuby 本地协议文档 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Cuby's own bilingual Terms of Service and Data Agreement as Markdown bundled with the desktop client, opened in an in-app modal instead of a remote URL.

**Architecture:** Four Markdown files under `src/legal/content/` are imported with Vite `?raw`; a pure resolver picks the document by kind + UI language. A prop-driven `LegalDocumentModal` renders it through the existing `Modal` + `react-markdown`. A single `legalDocument` field in app state lets any page open it without navigating, so the login form keeps its state. All `CUBY_LEGAL_*` build-time URL plumbing is removed from the desktop build; backend bootstrap `legal` stays untouched.

**Tech Stack:** TypeScript, React, Vite (`?raw` imports), `react-markdown` + `remark-gfm`, shared `Modal`, Vitest (`renderToString` and happy-dom interaction tests).

**Spec:** `docs/superpowers/specs/2026-11-23-cuby-legal-documents-design.md`

## Global Constraints

- Documents are bilingual: `zh-CN` and `en-US`; the Chinese version prevails and the English version says so.
- Chinese operator: 上海算丰信息有限公司. English operator: `Suanova Technology Ltd` (matches the official website).
- Contact: `info@isuanova.com` only; do not include a postal address.
- Accounts and model services are provided by CubeRouter; CubeRouter is the same operator (“我们” / “we”).
- The Cuby client itself is not separately charged; model usage is billed by CubeRouter under its published rules.
- The legal text must not contain `Memmy`, `memmy`, `记忆张量`, or `MemTensor` (case-insensitive). Describe cloud infrastructure generically as “我们委托的云服务提供商” / “cloud service providers engaged by us”.
- Do not mention BYOK, “自带 API Key”, “自定义模型”, or custom model connections. The product plans to disable them.
- Disclose that users can select a Hong Kong line and data may be processed in Hong Kong; do not add a separate cross-border consent UI.
- Data agreement must cover local-first storage, CubeRouter account data, device/logs, locally stored credentials, memory data, voice input, analytics events, improvement-program processing, third-party model providers, retention, rights, minors, and contact.
- Improvement program: default off, revocable; when on, may use and store conversations, prompts, agent operations, memory data, usage behavior, and crash/error information for product improvement and model training.
- Bundled local Markdown only; no remote legal URLs and no `CUBY_LEGAL_CN_BASE_URL` / `CUBY_LEGAL_INTL_BASE_URL` in the desktop build.
- Keep backend `bootstrap.legal` and `cloudClient.getLegalUrls()` untouched.
- Follow TDD: write the failing test, run it, implement, run it green, commit.

## Review Focus

- **Login state must survive reading a document:** opening/closing the legal modal must not change `navigation.currentPath`; the reducer test pins that the route (and therefore the mounted page) is untouched.
- **Wrong content in the wrong language:** every `kind` × language pair resolves to its own file, and the required entity/email/sections are present in each.
- **Old brand or removed feature leaks into legal text:** the content test bans Memmy/记忆张量/MemTensor and BYOK/custom-model wording.
- **External links navigate the Electron renderer:** every Markdown link must call `openExternalUrl` and prevent default; the modal interaction test pins this.
- **Build still demands legal URL env vars:** `vite.config.ts` must build with no `CUBY_LEGAL_*` values set; the Vite config test pins this.

---

### Task 1: Bilingual legal content and resolver

**Files:**
- Create: `App/frontend/desktop/src/legal/content/user-agreement.zh-CN.md`
- Create: `App/frontend/desktop/src/legal/content/user-agreement.en-US.md`
- Create: `App/frontend/desktop/src/legal/content/data-agreement.zh-CN.md`
- Create: `App/frontend/desktop/src/legal/content/data-agreement.en-US.md`
- Create: `App/frontend/desktop/src/legal/legal-content.ts`
- Create: `App/frontend/desktop/src/legal/tests/legal-content.test.ts`

**Interfaces:**
- Consumes: `ResolvedLanguage` from `../i18n/messages.js` (`"zh-CN" | "en-US"`).
- Produces: `export type LegalDocumentKind = "terms" | "data";` and `export function resolveLegalDocument(kind: LegalDocumentKind, language: ResolvedLanguage): string`. Later tasks import both from `./legal-content.js` / `../legal/legal-content.js`.

- [ ] **Step 1: Write the failing content test**

Create `App/frontend/desktop/src/legal/tests/legal-content.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveLegalDocument, type LegalDocumentKind } from "../legal-content.js";

const cases = [
  ["terms", "zh-CN"],
  ["terms", "en-US"],
  ["data", "zh-CN"],
  ["data", "en-US"]
] as const satisfies ReadonlyArray<readonly [LegalDocumentKind, "zh-CN" | "en-US"]>;

describe("resolveLegalDocument", () => {
  it.each(cases)("resolves %s in %s", (kind, language) => {
    expect(resolveLegalDocument(kind, language).trim().length).toBeGreaterThan(500);
  });

  it.each(cases)("keeps old brands and removed BYOK wording out of %s/%s", (kind, language) => {
    const text = resolveLegalDocument(kind, language);
    expect(text).not.toMatch(/memmy|记忆张量|memtensor/i);
    expect(text).not.toMatch(/BYOK|自带\s*API\s*Key|自定义模型|bring your own/i);
  });

  it("Chinese terms state the operator, contact, and required sections", () => {
    const text = resolveLegalDocument("terms", "zh-CN");
    for (const expected of [
      "# Cuby 服务协议",
      "上海算丰信息有限公司",
      "info@isuanova.com",
      "CubeRouter",
      "账号",
      "计费",
      "不单独收费",
      "MIT",
      "记忆",
      "改进计划",
      "争议解决",
      "中文版本为准"
    ]) expect(text).toContain(expected);
  });

  it("English terms state the operator, contact, and required sections", () => {
    const text = resolveLegalDocument("terms", "en-US");
    for (const expected of [
      "# Cuby Terms of Service",
      "Suanova Technology Ltd",
      "info@isuanova.com",
      "CubeRouter",
      "Account",
      "Fees",
      "not separately charged",
      "MIT",
      "Memory",
      "Improvement Program",
      "Governing Law",
      "Chinese version prevails"
    ]) expect(text).toContain(expected);
  });

  it("Chinese data agreement covers data flows, voice, Hong Kong, retention, and deletion", () => {
    const text = resolveLegalDocument("data", "zh-CN");
    for (const expected of [
      "# Cuby 数据协议",
      "上海算丰信息有限公司",
      "info@isuanova.com",
      "本地",
      "语音",
      "香港",
      "保留",
      "注销",
      "云服务提供商"
    ]) expect(text).toContain(expected);
  });

  it("English data agreement covers data flows, voice, Hong Kong, retention, and deletion", () => {
    const text = resolveLegalDocument("data", "en-US");
    for (const expected of [
      "# Cuby Data Agreement",
      "Suanova Technology Ltd",
      "info@isuanova.com",
      "local",
      "voice",
      "Hong Kong",
      "cloud service providers"
    ]) expect(text).toContain(expected);
    expect(text).toMatch(/retention/i);
    expect(text).toMatch(/deletion/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd App/frontend/desktop && npx vitest run src/legal/tests/legal-content.test.ts`
Expected: FAIL — cannot resolve `../legal-content.js` / module not found.

- [ ] **Step 3: Write the Chinese service agreement**

Create `App/frontend/desktop/src/legal/content/user-agreement.zh-CN.md` with title `# Cuby 服务协议`, the dates `最近更新日期：2026 年 11 月 23 日` and `生效日期：2026 年 11 月 23 日`, formal legal tone, and these numbered sections:

1. 协议的范围与接受
2. 定义（Cuby、CubeRouter、平台账号、模型服务、记忆采集/注入、改进计划、用户内容）
3. 服务内容（桌面客户端、跨 Agent 记忆、工具与消息通道、模型访问）
4. 账号与登录（CubeRouter 提供；用户名/密码，部分部署可能要求邮箱验证码；账号安全；不得批量注册或共享）
5. 费用、额度与计费（客户端不单独收费；模型服务由 CubeRouter 按公示规则计费；余额/额度以 CubeRouter 展示为准；欠费或额度耗尽可能停止服务；价格调整；退款按 CubeRouter 规则）
6. 模型服务与第三方（模型供应商、第三方 Agent、消息渠道；我们委托的云服务提供商）
7. 记忆采集与注入（仅授权后启用；本地存储；可随时关闭/删除；用户保证合法权限）
8. 自动化执行与风险（工具调用、文件/命令操作、生成内容的局限、备份建议）
9. 改进计划（默认关闭、可撤回；开启后可能使用对话、提示词、Agent 操作记录、记忆数据、使用行为、崩溃与错误信息，用于改进产品和训练模型）
10. 数据与隐私（引用《Cuby 数据协议》；冲突时以数据协议为准）
11. 知识产权（客户端依 MIT 许可证，保留版权声明；Cuby 名称/标识/文档归我们或相应权利人；用户内容归用户）
12. 用户行为规范
13. 服务的变更、中断与终止
14. 未成年人保护
15. 免责声明与责任限制
16. 法律适用与争议解决（中华人民共和国大陆地区法律；上海算丰信息有限公司所在地有管辖权的人民法院）
17. 协议的更新、语言版本与联系方式（中文版本为准；info@isuanova.com）

- [ ] **Step 4: Write the English service agreement**

Create `App/frontend/desktop/src/legal/content/user-agreement.en-US.md` with title `# Cuby Terms of Service`, the dates `Last updated: November 23, 2026` and `Effective: November 23, 2026`, and the same 17 sections with these headings:

1. Scope and Acceptance
2. Definitions
3. The Service
4. Accounts and Sign-in
5. Fees, Quotas, and Billing
6. Model Services and Third Parties
7. Memory Collection and Injection
8. Automated Execution and Risks
9. Improvement Program
10. Data and Privacy
11. Intellectual Property
12. Acceptable Use
13. Changes, Suspension, and Termination
14. Minors
15. Disclaimers and Limitation of Liability
16. Governing Law and Dispute Resolution
17. Updates, Language, and Contact

Use `Suanova Technology Ltd` (“we”, “us”). In the fees section state that the Cuby client is “not separately charged” and model usage is billed by CubeRouter under its published rules. In the intellectual-property section state that the client is licensed under the MIT License and preserve the copyright notice. Add: “This English version is provided for convenience only; if there is any conflict, the Chinese version prevails.”

- [ ] **Step 5: Write the Chinese data agreement**

Create `App/frontend/desktop/src/legal/content/data-agreement.zh-CN.md` with title `# Cuby 数据协议`, subtitle `（数据使用与隐私政策）`, the same dates as the Chinese service agreement, and these sections:

1. 概述与原则（本地优先、最小必要、用户控制）
2. 数据存储在哪里（对话/记忆/配置/凭证默认本地；CubeRouter 账号数据在 CubeRouter；云服务提供商承载分析、更新检查与语音转写）
3. 我们收集的信息（CubeRouter 账号信息、设备与日志、本机保存的凭证、记忆数据、语音输入、基础运行分析事件、改进计划开启后的对话/提示词/操作记录/记忆数据）
4. 数据何时离开你的设备（登录注册、记忆提炼、模型请求经 CubeRouter 路由、语音转写、分析事件、更新检查；选择香港线路时可能在香港处理）
5. CubeRouter、云服务提供商与第三方模型供应商（说明账号/模型服务、云基础设施、语音转写服务商；适用相关方的隐私政策）
6. 共享、转让与公开披露（不出售；服务商；法律要求）
7. 你的权利与选择（关闭改进计划、管理记忆、删除本地数据、访问/更正、退出/注销——注销可通过 CubeRouter 平台或 info@isuanova.com 申请）
8. 数据安全（合理措施；本地设备与账号凭证由用户保管）
9. 数据保留（本地数据保留至用户删除；云端数据在实现目的所需最短期限内保留，法律另有规定除外）
10. 未成年人保护
11. 政策的更新、语言版本与联系方式（中文版本为准；info@isuanova.com）

- [ ] **Step 6: Write the English data agreement**

Create `App/frontend/desktop/src/legal/content/data-agreement.en-US.md` with title `# Cuby Data Agreement`, subtitle `(Data Use and Privacy Policy)`, the same dates as the English service agreement, and these headings:

1. Overview and Principles
2. Where Your Data Is Stored
3. Information We Collect
4. When Data Leaves Your Device
5. CubeRouter, Cloud Providers, and Third-Party Model Providers
6. Sharing, Transfer, and Disclosure
7. Your Rights and Choices
8. Data Security
9. Retention
10. Minors
11. Updates, Language, and Contact

Add the same “Chinese version prevails” note. Name `Suanova Technology Ltd`, and include the phrase “cloud service providers engaged by us”.

- [ ] **Step 7: Implement the resolver**

Create `App/frontend/desktop/src/legal/legal-content.ts`:

```ts
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
```

- [ ] **Step 8: Run the content test to verify it passes**

Run: `cd App/frontend/desktop && npx vitest run src/legal/tests/legal-content.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add App/frontend/desktop/src/legal/content App/frontend/desktop/src/legal/legal-content.ts App/frontend/desktop/src/legal/tests/legal-content.test.ts
git commit -m "feat(legal): add bilingual Cuby agreement content"
```

---

### Task 2: Legal document modal

**Files:**
- Create: `App/frontend/desktop/src/legal/LegalDocumentModal.tsx`
- Create: `App/frontend/desktop/src/legal/tests/legal-document-modal.test.tsx`
- Modify: `App/frontend/desktop/src/styles.css` (add modal + markdown styles near the existing `.modal` rules around line 8704)

**Interfaces:**
- Consumes: `resolveLegalDocument`, `LegalDocumentKind` from `./legal-content.js`; shared `Modal` from `../components/modal.js`; `useTranslation` from `../i18n/use-translation.js`; `openExternalUrl` from `../utils/open-url.js`.
- Produces: `export function LegalDocumentModal(props: { kind: LegalDocumentKind | null; onClose: () => void }): ReactElement | null;` and, for the link test, `export function LegalMarkdown(props: { markdown: string }): ReactElement;`.

- [ ] **Step 1: Write the failing modal test**

Create `App/frontend/desktop/src/legal/tests/legal-document-modal.test.tsx`:

```tsx
// @vitest-environment happy-dom

import { act } from "react";
import { renderToString } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/i18n-provider.js";
import { LegalDocumentModal, LegalMarkdown } from "../LegalDocumentModal.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("LegalDocumentModal", () => {
  it("renders the Chinese terms title and content", () => {
    const html = renderToString(
      <I18nProvider language="zh-CN">
        <LegalDocumentModal kind="terms" onClose={() => undefined} />
      </I18nProvider>
    );
    expect(html).toContain("服务协议");
    expect(html).toContain("Cuby 服务协议");
    expect(html).toContain("返回");
  });

  it("renders the English data title and content", () => {
    const html = renderToString(
      <I18nProvider language="en-US">
        <LegalDocumentModal kind="data" onClose={() => undefined} />
      </I18nProvider>
    );
    expect(html).toContain("Data Agreement");
    expect(html).toContain("Cuby Data Agreement");
  });

  it("renders nothing when closed", () => {
    const html = renderToString(
      <I18nProvider language="zh-CN">
        <LegalDocumentModal kind={null} onClose={() => undefined} />
      </I18nProvider>
    );
    expect(html).not.toContain("modal-backdrop");
  });
});

describe("LegalMarkdown external links", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    window.localStorage.clear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    Reflect.deleteProperty(window, "memmy");
  });

  it("opens links through the desktop bridge instead of navigating", async () => {
    const openExternal = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, "memmy", { configurable: true, value: { openExternal } });

    await act(async () => {
      root.render(<I18nProvider language="zh-CN"><LegalMarkdown markdown="[规则](https://cuberouter.cn)" /></I18nProvider>);
    });

    const anchor = container.querySelector<HTMLAnchorElement>("a")!;
    await act(async () => anchor.click());

    expect(openExternal).toHaveBeenCalledWith("https://cuberouter.cn");
  });

  it("closes from the back button and Escape", async () => {
    const onClose = vi.fn();
    await act(async () => {
      root.render(<I18nProvider language="zh-CN"><LegalDocumentModal kind="terms" onClose={onClose} /></I18nProvider>);
    });

    const back = container.querySelector<HTMLButtonElement>('button[aria-label="返回"]')!;
    await act(async () => back.click());
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd App/frontend/desktop && npx vitest run src/legal/tests/legal-document-modal.test.tsx`
Expected: FAIL — cannot resolve `../LegalDocumentModal.js`.

- [ ] **Step 3: Implement `LegalDocumentModal`**

Create `App/frontend/desktop/src/legal/LegalDocumentModal.tsx`:

```tsx
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
```

- [ ] **Step 4: Add the modal and typography styles**

In `App/frontend/desktop/src/styles.css`, next to `.modal` (~line 8704), add:

```css
.modal.legal-document-modal {
  display: flex;
  width: min(800px, calc(100vw - 64px));
  max-height: calc(100vh - 48px);
  flex-direction: column;
}

.legal-document-modal__body {
  min-height: 0;
  overflow-y: auto;
  padding: 0 32px 32px;
}

.legal-document {
  color: var(--color-text-ink);
  font-size: 14px;
  line-height: 1.8;
}

.legal-document h1 {
  margin: 0 0 8px;
  font-size: 24px;
  line-height: 1.35;
}

.legal-document h2 {
  margin: 24px 0 8px;
  font-size: 16px;
  line-height: 1.45;
}

.legal-document p,
.legal-document ul,
.legal-document ol,
.legal-document table,
.legal-document blockquote {
  margin: 8px 0;
}

.legal-document ul,
.legal-document ol {
  padding-left: 1.4em;
}

.legal-document table {
  width: 100%;
  border-collapse: collapse;
}

.legal-document th,
.legal-document td {
  border: 1px solid var(--color-border-stone);
  padding: 6px 8px;
  text-align: left;
  vertical-align: top;
}

.legal-document blockquote {
  border-left: 3px solid var(--color-action-sky);
  padding-left: 12px;
  color: color-mix(in srgb, var(--color-text-ink) 70%, transparent);
}

.legal-document__link {
  color: var(--color-action-sky);
  text-decoration: underline;
}

@media (max-width: 640px) {
  .modal.legal-document-modal {
    width: calc(100vw - 32px);
  }

  .legal-document-modal__body {
    padding: 0 20px 24px;
  }
}
```

- [ ] **Step 5: Run the modal test to verify it passes**

Run: `cd App/frontend/desktop && npx vitest run src/legal/tests/legal-document-modal.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add App/frontend/desktop/src/legal/LegalDocumentModal.tsx App/frontend/desktop/src/legal/tests/legal-document-modal.test.tsx App/frontend/desktop/src/styles.css
git commit -m "feat(legal): render bundled agreements in an in-app modal"
```

---

### Task 3: App state, actions, and global mount

**Files:**
- Modify: `App/frontend/desktop/src/state/app-actions.ts` (action union near line 120; helper object near line 266)
- Modify: `App/frontend/desktop/src/state/app-reducer.ts` (state interface near line 71; initial state near line 154; reducer near line 422)
- Modify: `App/frontend/desktop/src/state/tests/app-reducer.test.ts`
- Create: `App/frontend/desktop/src/app/tests/legal-modal-mount.test.ts`
- Modify: `App/frontend/desktop/src/app/router.tsx` (imports; root return near line 305)

**Interfaces:**
- Consumes: `LegalDocumentKind` from `../legal/legal-content.js`; `LegalDocumentModal` from `../legal/LegalDocumentModal.js`.
- Produces: `AppState.legalDocument: LegalDocumentKind | null`; `appActions.openLegalDocument(kind)`; `appActions.closeLegalDocument()`; action types `"legal/opened"` and `"legal/closed"`.

- [ ] **Step 1: Write the failing reducer test**

Append to `App/frontend/desktop/src/state/tests/app-reducer.test.ts`:

```ts
it("opens and closes a legal document without changing the route", () => {
  const initial = createInitialAppState();
  const opened = appReducer(initial, appActions.openLegalDocument("terms"));

  expect(opened.legalDocument).toBe("terms");
  expect(opened.navigation).toEqual(initial.navigation);

  const switched = appReducer(opened, appActions.openLegalDocument("data"));
  expect(switched.legalDocument).toBe("data");
  expect(switched.navigation).toEqual(initial.navigation);

  const closed = appReducer(switched, appActions.closeLegalDocument());
  expect(closed.legalDocument).toBeNull();
  expect(closed.navigation).toEqual(initial.navigation);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd App/frontend/desktop && npx vitest run src/state/tests/app-reducer.test.ts -t "opens and closes a legal document"`
Expected: FAIL — `appActions.openLegalDocument` is not a function / `legalDocument` missing.

- [ ] **Step 3: Write the failing router mount test**

Create `App/frontend/desktop/src/app/tests/legal-modal-mount.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const routerSource = readFileSync(fileURLToPath(new URL("../router.tsx", import.meta.url)), "utf8");

describe("AppRouter legal modal", () => {
  it("mounts the legal modal at the router root", () => {
    expect(routerSource).toContain("<LegalDocumentModal");
    expect(routerSource).toContain("kind={state.legalDocument}");
    expect(routerSource).toContain("appActions.closeLegalDocument()");
  });
});
```

Run: `cd App/frontend/desktop && npx vitest run src/app/tests/legal-modal-mount.test.ts`
Expected: FAIL — the router does not contain `LegalDocumentModal`.

- [ ] **Step 4: Add the state, action types, and helpers**

In `app-actions.ts`:

```ts
import type { LegalDocumentKind } from "../legal/legal-content.js";
```

Add to the `AppAction` union:

```ts
| { type: "legal/opened"; document: LegalDocumentKind }
| { type: "legal/closed" }
```

Add to `appActions` next to `modalChanged`:

```ts
/** Opens a bundled legal document overlay. */
openLegalDocument(document: LegalDocumentKind): AppAction {
  return { type: "legal/opened", document };
},

/** Closes the bundled legal document overlay. */
closeLegalDocument(): AppAction {
  return { type: "legal/closed" };
},
```

In `app-reducer.ts`, import the type:

```ts
import type { LegalDocumentKind } from "../legal/legal-content.js";
```

Add to `AppState`:

```ts
/** Currently open bundled legal document, or null. */
legalDocument: LegalDocumentKind | null;
```

Add to `createInitialAppState()`:

```ts
legalDocument: null,
```

Add reducer cases before `default`:

```ts
case "legal/opened":
  return { ...state, legalDocument: action.document };
case "legal/closed":
  return { ...state, legalDocument: null };
```

- [ ] **Step 5: Mount the modal in the router**

In `AppRouter`'s ready-state return, after `<GlobalUpdateDialog ... />`, add:

```tsx
<LegalDocumentModal
  kind={state.legalDocument}
  onClose={() => dispatch(appActions.closeLegalDocument())}
/>
```

Import at the top of `router.tsx`:

```ts
import { LegalDocumentModal } from "../legal/LegalDocumentModal.js";
```

- [ ] **Step 6: Run the reducer and router tests, then typecheck**

Run: `cd App/frontend/desktop && npx vitest run src/state/tests/app-reducer.test.ts src/app/tests/legal-modal-mount.test.ts -t "legal"`
Expected: PASS.

Run: `cd App/frontend/desktop && npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add App/frontend/desktop/src/state/app-actions.ts App/frontend/desktop/src/state/app-reducer.ts App/frontend/desktop/src/state/tests/app-reducer.test.ts App/frontend/desktop/src/app/router.tsx App/frontend/desktop/src/app/tests/legal-modal-mount.test.ts
git commit -m "feat(legal): add app-level legal document state"
```

---

### Task 4: Wire all legal entry points

**Files:**
- Modify: `App/frontend/desktop/src/components/account-auth-panel.tsx` (imports at lines 12 and 27; callbacks at lines 369–370)
- Modify: `App/frontend/desktop/src/pages/settings-page.tsx` (imports at lines 21 and 24; callbacks at lines 1667 and 1956)
- Modify: `App/frontend/desktop/src/pages/app-frame.tsx` (imports at lines 27 and 37; callback at line 1594)
- Modify: `App/frontend/desktop/src/pages/tests/welcome-page-legal-link.test.ts`
- Modify: `App/frontend/desktop/src/pages/tests/settings-page.test.tsx` (assertions at lines 360 and 386)
- Modify: `App/frontend/desktop/src/pages/tests/app-frame.test.tsx` (assertion at line 472)
- Modify: `App/frontend/desktop/src/pages/tests/prototype-modals.test.ts` (assertion at line 23)

**Interfaces:**
- Consumes: `appActions.openLegalDocument("terms" | "data")` from Task 3.
- Produces: no new API; all four entry points dispatch the local overlay instead of opening an external URL.

- [ ] **Step 1: Rewrite the legal-entry source tests first**

Replace `App/frontend/desktop/src/pages/tests/welcome-page-legal-link.test.ts` with:

```ts
/** Welcome page legal link tests. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const authPanelSourcePath = fileURLToPath(new URL("../../components/account-auth-panel.tsx", import.meta.url));

describe("WelcomePage 协议入口", () => {
  it("服务协议入口打开应用内本地协议", () => {
    const source = readSource(authPanelSourcePath);
    expect(source).toContain('appActions.openLegalDocument("terms")');
    expect(source).not.toContain("getLegalLinkUrl");
    expect(source).not.toContain("openExternalUrl");
  });

  it("数据协议入口打开应用内本地协议", () => {
    const source = readSource(authPanelSourcePath);
    expect(source).toContain('appActions.openLegalDocument("data")');
  });

  it("协议入口不导航到应用内 /terms 或 /data-use 路由", () => {
    const source = readSource(authPanelSourcePath);
    expect(source).not.toContain('appActions.navigate("/terms")');
    expect(source).not.toContain('appActions.navigate("/data-use")');
  });
});

function readSource(path: string): string {
  return readFileSync(path, "utf8");
}
```

Update the two assertions in `settings-page.test.tsx`:

```ts
expect(source).toContain('appActions.openLegalDocument("data")');
expect(source).not.toContain("getLegalLinkUrl");
expect(source).not.toContain('appActions.navigate("/data-use")');
```

and

```ts
expect(source).toContain('appActions.openLegalDocument("terms")');
expect(source).not.toContain("getLegalLinkUrl");
expect(source).not.toContain('appActions.navigate("/terms")');
```

Update the `app-frame.test.tsx` assertion:

```ts
expect(appFrameSource).toContain('appActions.openLegalDocument("data")');
```

Update the `prototype-modals.test.ts` assertion:

```ts
expect(pageSource).toContain('appActions.openLegalDocument("data")');
```

- [ ] **Step 2: Run the updated tests to verify they fail**

Run: `cd App/frontend/desktop && npx vitest run src/pages/tests/welcome-page-legal-link.test.ts src/pages/tests/settings-page.test.tsx src/pages/tests/app-frame.test.tsx src/pages/tests/prototype-modals.test.ts`
Expected: FAIL — sources still contain `getLegalLinkUrl` / `openExternalUrl`.

- [ ] **Step 3: Replace the four entry points**

`account-auth-panel.tsx`:

```tsx
const { t } = useTranslation();
// ...
onOpenTerms={() => dispatch(appActions.openLegalDocument("terms"))}
onOpenDataAgreement={() => dispatch(appActions.openLegalDocument("data"))}
```

Remove `import { getLegalLinkUrl } ...` and `import { openExternalUrl } ...`.

`settings-page.tsx`:

```tsx
onClick={() => dispatch(appActions.openLegalDocument("data"))}
// ...
<LinkButton label={t("settings.about.terms")} onClick={() => dispatch(appActions.openLegalDocument("terms"))} />
```

Remove `getLegalLinkUrl` and `openExternalUrl` imports.

`app-frame.tsx`:

```tsx
onLearnMore={() => dispatch(appActions.openLegalDocument("data"))}
```

Remove `getLegalLinkUrl` and `openExternalUrl` imports.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd App/frontend/desktop && npx vitest run src/pages/tests/welcome-page-legal-link.test.ts src/pages/tests/settings-page.test.tsx src/pages/tests/app-frame.test.tsx src/pages/tests/prototype-modals.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add App/frontend/desktop/src/components/account-auth-panel.tsx App/frontend/desktop/src/pages/settings-page.tsx App/frontend/desktop/src/pages/app-frame.tsx App/frontend/desktop/src/pages/tests/welcome-page-legal-link.test.ts App/frontend/desktop/src/pages/tests/settings-page.test.tsx App/frontend/desktop/src/pages/tests/app-frame.test.tsx App/frontend/desktop/src/pages/tests/prototype-modals.test.ts
git commit -m "feat(legal): open bundled agreements from every entry point"
```

---

### Task 5: Remove remote legal URL plumbing

**Files:**
- Delete: `App/frontend/desktop/src/legal/legal-links.ts`
- Delete: `App/frontend/desktop/src/legal/tests/legal-links.test.ts`
- Modify: `App/frontend/desktop/vite.config.ts` (lines 13, 19–20, 28–35, 44–49)
- Modify: `App/frontend/desktop/src/tests/vite-config.test.ts` (lines 27–44)
- Modify: `.env.example` (lines 16–18)
- Modify: `.github/workflows/build-desktop.yml` (lines 114–115 and 192–193)
- Modify: `scripts/package-win-local.sh` (comment lines 11–13; `REQUIRED_ENV_KEYS` line 41)
- Modify: `App/memmy-agent/tests/build-assets.test.ts` (lines 10–12)
- Modify: `App/memmy-agent/tests/skills/office-skills.test.ts` (lines 9–11)
- Modify: `tests/packaged-runtime-config.test.mjs` (legal decoy lines 44 and 66)
- Modify: `docs/superpowers/TODO.md` (legal bullet)

**Interfaces:**
- Consumes: nothing from earlier tasks beyond the removal of `getLegalLinkUrl` (already unused after Task 4).
- Produces: a desktop build that no longer reads `CUBY_LEGAL_CN_BASE_URL` / `CUBY_LEGAL_INTL_BASE_URL`.

- [ ] **Step 1: Add the failing Vite config test**

In `App/frontend/desktop/src/tests/vite-config.test.ts`, remove the two legal validation tests (`isolates test validation...` and `keeps development validation strict`) and add:

```ts
it("builds without legal URL environment variables", () => {
  expect(() => resolveConfig("development")).not.toThrow();
});

it("does not expose legal URL variables to the renderer", () => {
  expect(PUBLIC_MEMMY_RENDERER_ENV_KEYS).not.toContain("CUBY_LEGAL_CN_BASE_URL");
  expect(PUBLIC_MEMMY_RENDERER_ENV_KEYS).not.toContain("CUBY_LEGAL_INTL_BASE_URL");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd App/frontend/desktop && npx vitest run src/tests/vite-config.test.ts`
Expected: FAIL — `resolveConfig("development")` still throws `CUBY_LEGAL_CN_BASE_URL must be an HTTPS origin...`, and the allowlist still contains the keys.

- [ ] **Step 3: Remove legal validation and renderer exposure from Vite**

In `App/frontend/desktop/vite.config.ts`:

- Delete `LEGAL_BASE_URL_ENV_KEYS`.
- Delete the two `CUBY_LEGAL_*` entries from `PUBLIC_MEMMY_RENDERER_ENV_KEYS`.
- Delete `validateLegalEnv`.
- Replace the `validationEnv` construction with `env`; in `publicMemmyEnv`, read `env[key]` instead of `validationEnv[key]`.

- [ ] **Step 4: Delete the old link module and its test**

```bash
rm App/frontend/desktop/src/legal/legal-links.ts
rm App/frontend/desktop/src/legal/tests/legal-links.test.ts
```

- [ ] **Step 5: Remove the env values from build and packaging**

- `.env.example`: delete the “Legal agreement page base URLs” block and both keys.
- `.github/workflows/build-desktop.yml`: delete the two `CUBY_LEGAL_*` lines in both Windows and macOS jobs.
- `scripts/package-win-local.sh`: change `REQUIRED_ENV_KEYS=(CUBY_LEGAL_CN_BASE_URL CUBY_LEGAL_INTL_BASE_URL CUBY_CLOUD_SERVICE)` to `REQUIRED_ENV_KEYS=(CUBY_CLOUD_SERVICE)`; update the header comment so it no longer claims three values or cites the legal error.
- `App/memmy-agent/tests/build-assets.test.ts` and `tests/skills/office-skills.test.ts`: remove the two `CUBY_LEGAL_*` stub lines.
- `tests/packaged-runtime-config.test.mjs`: remove the `CUBY_LEGAL_CN_BASE_URL=https://legal.example.test` decoy line from the env fixture and the matching `not.toContain("CUBY_LEGAL_CN_BASE_URL")` assertion. `CUBY_PRIVATE_TOKEN` still proves only the allowlist is serialized.

- [ ] **Step 6: Update the TODO**

Replace the legal bullet in `docs/superpowers/TODO.md` with:

```md
- [ ] **Docs** — Memory documentation still links to `memmy.cn` / `memmy.bot`.
  Point it at the Cuby domains. The service and data agreements now ship as
  bundled local Markdown and no longer depend on remote URLs.
```

- [ ] **Step 7: Run the affected tests**

Run: `cd App/frontend/desktop && npx vitest run src/tests/vite-config.test.ts`
Expected: PASS.

Run: `cd App/memmy-agent && npx vitest run tests/build-assets.test.ts tests/skills/office-skills.test.ts`
Expected: PASS.

Run: `cd /home/skeeey/workspace/cuby && npx vitest run tests/packaged-runtime-config.test.mjs`
Expected: PASS.

Run: `grep -rn "CUBY_LEGAL" --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git --exclude-dir=docs /home/skeeey/workspace/cuby`
Expected: no output (docs/ is excluded because older specs may quote the removed variables).

- [ ] **Step 8: Commit**

```bash
git add -A App/frontend/desktop/src/legal App/frontend/desktop/vite.config.ts App/frontend/desktop/src/tests/vite-config.test.ts .env.example .github/workflows/build-desktop.yml scripts/package-win-local.sh App/memmy-agent/tests/build-assets.test.ts App/memmy-agent/tests/skills/office-skills.test.ts tests/packaged-runtime-config.test.mjs docs/superpowers/TODO.md
git commit -m "refactor(legal): drop remote agreement URL build inputs"
```

---

### Task 6: Final verification

**Files:**
- No source changes expected; fix anything the full suite surfaces.

- [ ] **Step 1: Run the full desktop test suite**

Run: `cd App/frontend/desktop && npm test`
Expected: all tests pass.

- [ ] **Step 2: Run the desktop typecheck**

Run: `cd App/frontend/desktop && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Confirm the content contract one last time**

Run: `grep -rniE "memmy|记忆张量|memtensor|BYOK|自带[[:space:]]*API[[:space:]]*Key|自定义模型" App/frontend/desktop/src/legal/content`
Expected: no output.

Run: `grep -rn "CUBY_LEGAL" --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git --exclude-dir=docs .`
Expected: no output (docs/ is excluded because older specs may quote the removed variables).

- [ ] **Step 4: Commit any fixes**

Only if the verification steps required changes:

```bash
git add -A
git commit -m "test(legal): verify bundled agreement flow"
```
