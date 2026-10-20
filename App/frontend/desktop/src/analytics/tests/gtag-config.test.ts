import { describe, expect, it } from "vitest";
import {
  resolveAnalyticsAppEdition,
  resolveAnalyticsAppEnv,
  resolveGtagConfigOptions,
  resolveGtagDebugMode
} from "../gtag-config.js";

describe("gtag config", () => {
  it("maps build mode to app_env", () => {
    expect(resolveAnalyticsAppEnv(true)).toBe("prod");
    expect(resolveAnalyticsAppEnv(false)).toBe("dev");
  });

  it("derives app_edition from the UI language", () => {
    expect(resolveAnalyticsAppEdition("zh-CN")).toBe("cn");
    expect(resolveAnalyticsAppEdition("zh-TW")).toBe("cn");
    expect(resolveAnalyticsAppEdition("en-US")).toBe("intl");
    expect(resolveAnalyticsAppEdition("fr-FR")).toBe("intl");
    expect(resolveAnalyticsAppEdition("")).toBe("intl");
  });

  it("enables debug_mode in dev or when explicitly requested", () => {
    expect(resolveGtagDebugMode(true, false)).toBe(true);
    expect(resolveGtagDebugMode(false, true)).toBe(true);
    expect(resolveGtagDebugMode(false, false)).toBe(false);
  });

  it("includes app_env, app_edition, and debug_mode in gtag config options", () => {
    expect(
      resolveGtagConfigOptions({
        isProd: false,
        isDev: true,
        explicitDebug: false,
        appEdition: "cn"
      })
    ).toEqual({
      send_page_view: false,
      app_env: "dev",
      app_edition: "cn",
      debug_mode: 1
    });

    expect(
      resolveGtagConfigOptions({
        isProd: true,
        isDev: false,
        explicitDebug: false,
        appEdition: "intl"
      })
    ).toEqual({
      send_page_view: false,
      app_env: "prod",
      app_edition: "intl"
    });

    expect(
      resolveGtagConfigOptions({
        isProd: true,
        isDev: false,
        explicitDebug: true,
        appEdition: "cn"
      })
    ).toEqual({
      send_page_view: false,
      app_env: "prod",
      app_edition: "cn",
      debug_mode: 1
    });
  });
});
