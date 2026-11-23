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
