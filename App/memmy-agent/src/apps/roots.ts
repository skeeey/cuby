import path from "node:path";

export type AppRoots = {
  bundled: string | null;
  user: string;
  data: string;
  dev: string[];
};

export function resolveAppRoots(env: NodeJS.ProcessEnv = process.env): AppRoots {
  const home = env.HOME || env.USERPROFILE || process.cwd();
  const userData = env.CUBY_USER_DATA?.trim() || path.join(home, ".cuby");
  return {
    bundled: env.CUBY_BUNDLED_APPS_DIR?.trim() || null,
    user: env.CUBY_USER_APPS_DIR?.trim() || path.join(userData, "apps"),
    data: env.CUBY_APP_DATA_DIR?.trim() || path.join(userData, "app-data"),
    dev: (env.CUBY_DEV_APPS ?? "").split(",").map((value) => value.trim()).filter(Boolean),
  };
}
