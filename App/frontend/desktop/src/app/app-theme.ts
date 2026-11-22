const TOKEN_MAP: Record<string, string> = {
  "--color-background-primary": "--color-background-paper",
  "--color-background-secondary": "--color-canvas-oat",
  "--color-text-primary": "--color-text-ink",
  "--color-text-secondary": "--color-ink-muted",
  "--color-border-primary": "--color-border-stone",
  "--color-ring-primary": "--color-action-sky",
  "--font-sans": "--font-sans",
  "--font-mono": "--font-mono",
  "--border-radius-md": "--radius-card",
  "--border-radius-sm": "--radius-btn",
  "--shadow-md": "--shadow-card",
};

export function detectCubyTheme(): "light" | "dark" {
  if (typeof document === "undefined") return "light";
  const root = document.documentElement;
  return root.dataset.theme === "dark" || root.classList.contains("dark") ? "dark" : "light";
}

export function detectCubyLocale(): string {
  return typeof navigator !== "undefined" && navigator.language ? navigator.language : "en-US";
}

export function cubyHostContext(input: {
  displayMode: "inline" | "fullscreen";
  container: { width: number; height?: number; maxHeight?: number };
  locale: string;
  theme: "light" | "dark";
  readToken?: (name: string) => string;
}): Record<string, unknown> {
  const readToken = input.readToken ?? ((name: string) => {
    if (typeof document === "undefined") return "";
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  });

  const variables: Record<string, string> = {};
  for (const [target, source] of Object.entries(TOKEN_MAP)) {
    const value = readToken(source);
    if (value) variables[target] = value;
  }

  return {
    theme: input.theme,
    displayMode: input.displayMode,
    availableDisplayModes: ["inline", "fullscreen"],
    containerDimensions: input.container,
    locale: input.locale,
    timeZone: typeof Intl !== "undefined"
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : undefined,
    platform: "desktop",
    deviceCapabilities: { touch: false, hover: true },
    safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
    styles: { variables },
  };
}
