#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseAppManifest } from "../../App/backend/local-api-contracts/dist/index.js";

const DEFAULT_INCLUDE = ["app.json", "server/**", "ui/**", "runtime/**", "assets/**"];
const EXCLUDED_SEGMENTS = new Set(["node_modules", "__pycache__", ".venv", ".git"]);
const EXCLUDED_SUFFIXES = [".pyc"];

function readSelection(rootDir, selection, env) {
  if (Array.isArray(selection)) return selection;
  if (Object.prototype.hasOwnProperty.call(env, "CUBY_APPS")) {
    const value = env.CUBY_APPS;
    if (typeof value !== "string") return [];
    return value.split(",").map((entry) => entry.trim()).filter(Boolean);
  }
  const configPath = path.join(rootDir, "cuby.apps.json");
  if (existsSync(configPath)) {
    const parsed = JSON.parse(readFileSync(configPath, "utf8"));
    if (Array.isArray(parsed?.apps)) return parsed.apps.map(String);
  }
  return [];
}

function discoverApps(rootDir) {
  const appsDir = path.join(rootDir, "apps");
  if (!existsSync(appsDir)) return [];
  return readdirSync(appsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(path.join(appsDir, entry.name, "app.json")))
    .map((entry) => ({ id: entry.name, dir: path.join(appsDir, entry.name) }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function commandForPlatform(command) {
  if (typeof command === "string" && command.trim()) return command;
  if (!command || typeof command !== "object" || Array.isArray(command)) return null;
  return command[`${process.platform}-${process.arch}`] ?? null;
}

function isExcluded(relativePath) {
  const segments = relativePath.split(/[\\/]/);
  if (segments.some((segment) => EXCLUDED_SEGMENTS.has(segment))) return true;
  return EXCLUDED_SUFFIXES.some((suffix) => relativePath.endsWith(suffix));
}

function includeRoot(pattern) {
  const index = pattern.indexOf("/**");
  return index >= 0 ? pattern.slice(0, index) : pattern;
}

function matchesExclude(relativePath, pattern) {
  const normalized = relativePath.split(path.sep).join("/");
  if (pattern.startsWith("**/")) {
    const rest = pattern.slice(3);
    if (rest.endsWith("/**")) {
      return normalized.split("/").includes(rest.slice(0, -3));
    }
    if (rest.startsWith("*.")) {
      return normalized.endsWith(rest.slice(1));
    }
  }
  return normalized === pattern
    || normalized.startsWith(`${pattern.replace(/\/\*\*$/, "")}/`);
}

function copyIncludes(appDir, outDir, include, exclude) {
  const patterns = [...new Set([...(include.length ? include : DEFAULT_INCLUDE), "app.json"])];
  for (const pattern of patterns) {
    const relativeRoot = includeRoot(pattern);
    const source = path.join(appDir, relativeRoot);
    if (!existsSync(source)) continue;
    cpSync(source, path.join(outDir, relativeRoot), {
      recursive: true,
      filter: (entry) => {
        const relativePath = path.relative(appDir, entry);
        if (!relativePath) return true;
        if (isExcluded(relativePath)) return false;
        return !exclude.some((excluded) => matchesExclude(relativePath, excluded));
      },
    });
  }
}

function hashTree(dir) {
  const hash = createHash("sha256");
  const files = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else if (entry.isFile()) files.push(fullPath);
    }
  };
  walk(dir);
  files.sort();
  for (const file of files) {
    hash.update(path.relative(dir, file).split(path.sep).join("/"));
    hash.update("\0");
    hash.update(readFileSync(file));
  }
  return hash.digest("hex");
}

export async function buildApps({ rootDir, outDir, selection, env = process.env }) {
  const apps = discoverApps(rootDir);
  const selected = readSelection(rootDir, selection, env);
  const all = selected.includes("*");
  const chosen = all ? apps : apps.filter((app) => selected.includes(app.id));
  const result = { apps: [], skipped: [] };

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  for (const app of chosen) {
    try {
      const raw = JSON.parse(readFileSync(path.join(app.dir, "app.json"), "utf8"));
      if (raw?.dev && env.CUBY_ALLOW_DEV_APP !== "1") {
        throw new Error("dev-only apps cannot be bundled");
      }
      const manifest = parseAppManifest(raw);
      if (manifest.id !== app.id) {
        throw new Error(`directory id ${app.id} must match manifest id ${manifest.id}`);
      }
      for (const resource of manifest.ui?.resources ?? []) {
        if (!existsSync(path.join(app.dir, resource.entry))) {
          throw new Error(`UI entry is missing: ${resource.entry}`);
        }
      }
      if (!commandForPlatform(manifest.server.command)) {
        throw new Error(`no server command for ${process.platform}-${process.arch}`);
      }
      if (manifest.build?.ui) {
        execFileSync(manifest.build.ui.command, {
          cwd: app.dir,
          stdio: "inherit",
          shell: true,
        });
        if (!existsSync(path.join(app.dir, manifest.build.ui.output))) {
          throw new Error(`UI build output is missing: ${manifest.build.ui.output}`);
        }
      }

      const destination = path.join(outDir, app.id);
      mkdirSync(destination, { recursive: true });
      copyIncludes(
        app.dir,
        destination,
        manifest.build?.include ?? DEFAULT_INCLUDE,
        manifest.build?.exclude ?? [],
      );

      const hash = hashTree(destination);
      result.apps.push({ id: app.id, version: manifest.version, hash, path: app.id, manifest });
    } catch (error) {
      if (env.CUBY_APPS_STRICT === "1") throw error;
      result.skipped.push({ id: app.id, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  const registry = {
    schemaVersion: 1,
    hostApiVersion: 1,
    generatedAt: new Date().toISOString(),
    apps: result.apps.map(({ id, version, path: appPath, hash, manifest }) => ({
      id,
      version,
      path: appPath,
      hash,
      manifest,
    })),
  };
  writeFileSync(path.join(outDir, "registry.json"), JSON.stringify(registry, null, 2));

  return {
    apps: result.apps.map(({ id, version, hash }) => ({ id, version, hash })),
    skipped: result.skipped,
  };
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const args = process.argv.slice(2);
  if (args.includes("--list")) {
    console.log(discoverApps(process.cwd()).map((app) => app.id).join("\n"));
  } else {
    const outIndex = args.indexOf("--out");
    const appsIndex = args.indexOf("--apps");
    const invalidOut = outIndex >= 0 && (!args[outIndex + 1] || args[outIndex + 1].startsWith("--"));
    const invalidApps = appsIndex >= 0 && (!args[appsIndex + 1] || args[appsIndex + 1].startsWith("--"));
    if (invalidOut || invalidApps) {
      console.error(invalidOut
        ? "--out requires a directory path"
        : "--apps requires a comma-separated app id list");
      process.exitCode = 1;
    } else {
      const outDir = outIndex >= 0
        ? path.resolve(args[outIndex + 1])
        : path.join(process.cwd(), "dist", "apps");
      const selection = appsIndex >= 0
        ? args[appsIndex + 1].split(",").map((value) => value.trim()).filter(Boolean)
        : undefined;
      const result = await buildApps({ rootDir: process.cwd(), outDir, selection });
      console.log(JSON.stringify(result, null, 2));
      if (result.skipped.length) {
        for (const skipped of result.skipped) {
          console.error(`skipped ${skipped.id}: ${skipped.reason}`);
        }
      }
    }
  }
}
