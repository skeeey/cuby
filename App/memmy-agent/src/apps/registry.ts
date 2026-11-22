import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { parseAppManifest, type AppManifest } from "@memmy/local-api-contracts";
import type { AppRoots } from "./roots.js";

export type AppSource = "bundled" | "user" | "dev";

export type AppRegistryEntry = {
  id: string;
  version: string;
  path: string;
  source: AppSource;
  manifest: AppManifest;
  hash?: string;
};

export type AppRegistryError = {
  path: string;
  message: string;
};

type RegistryApp = {
  id?: unknown;
  version?: unknown;
  path?: unknown;
  hash?: unknown;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function loadAppDir(
  dir: string,
  source: AppSource,
  errors: AppRegistryError[],
  hash?: string,
): AppRegistryEntry | null {
  const manifestPath = path.join(dir, "app.json");
  try {
    const raw = JSON.parse(readFileSync(manifestPath, "utf8"));
    const manifest = parseAppManifest(raw);
    return {
      id: manifest.id,
      version: manifest.version,
      path: dir,
      source,
      manifest,
      ...(hash ? { hash } : {}),
    };
  } catch (error) {
    errors.push({ path: dir, message: errorMessage(error) });
    return null;
  }
}

function loadRegistryFile(
  root: string | null,
  source: Exclude<AppSource, "dev">,
  errors: AppRegistryError[],
): AppRegistryEntry[] {
  if (!root) return [];
  const registryPath = path.join(root, "registry.json");
  if (!existsSync(registryPath)) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(registryPath, "utf8"));
  } catch (error) {
    errors.push({ path: registryPath, message: errorMessage(error) });
    return [];
  }

  const apps = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as { apps?: unknown }).apps
    : null;
  if (!Array.isArray(apps)) {
    errors.push({ path: registryPath, message: "registry.json is missing an apps array" });
    return [];
  }

  const entries: AppRegistryEntry[] = [];
  for (const item of apps as RegistryApp[]) {
    if (!item || typeof item !== "object" || typeof item.path !== "string" || !item.path.trim()) {
      errors.push({ path: registryPath, message: "registry.json contains an app without a path" });
      continue;
    }
    const appDir = path.isAbsolute(item.path) ? item.path : path.resolve(root, item.path);
    const entry = loadAppDir(
      appDir,
      source,
      errors,
      typeof item.hash === "string" && item.hash ? item.hash : undefined,
    );
    if (!entry) continue;
    if (typeof item.id === "string" && item.id !== entry.id) {
      errors.push({
        path: appDir,
        message: `registry id ${item.id} does not match manifest id ${entry.id}`,
      });
      continue;
    }
    entries.push(entry);
  }
  return entries;
}

function discoverDevApps(paths: string[], errors: AppRegistryError[]): AppRegistryEntry[] {
  const entries: AppRegistryEntry[] = [];
  for (const rawPath of paths) {
    const devPath = path.resolve(rawPath);
    if (!existsSync(devPath)) {
      errors.push({ path: devPath, message: "app path does not exist" });
      continue;
    }
    if (existsSync(path.join(devPath, "app.json"))) {
      const entry = loadAppDir(devPath, "dev", errors);
      if (entry) entries.push(entry);
      continue;
    }

    let children;
    try {
      children = readdirSync(devPath, { withFileTypes: true });
    } catch (error) {
      errors.push({ path: devPath, message: errorMessage(error) });
      continue;
    }
    for (const child of children) {
      if (!child.isDirectory()) continue;
      const appDir = path.join(devPath, child.name);
      if (!existsSync(path.join(appDir, "app.json"))) continue;
      const entry = loadAppDir(appDir, "dev", errors);
      if (entry) entries.push(entry);
    }
  }
  return entries;
}

export function loadAppRegistry(roots: AppRoots): {
  entries: AppRegistryEntry[];
  errors: AppRegistryError[];
} {
  const errors: AppRegistryError[] = [];
  const byId = new Map<string, AppRegistryEntry>();

  for (const entry of loadRegistryFile(roots.bundled, "bundled", errors)) {
    byId.set(entry.id, entry);
  }
  for (const entry of loadRegistryFile(roots.user, "user", errors)) {
    byId.set(entry.id, entry);
  }
  for (const entry of discoverDevApps(roots.dev, errors)) {
    byId.set(entry.id, entry);
  }

  const entries = [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
  return { entries, errors };
}
