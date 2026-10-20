import { win32 } from "node:path";

export interface WindowsDataLayout {
  userDataPath: string;
  runtimeHomePath: string;
  updatesPath: string;
}

export interface ResolveWindowsDataLayoutOptions {
  platform: NodeJS.Platform;
  isPackaged: boolean;
  isWindowsStore: boolean;
  executablePath: string;
  appDataPath: string;
  homeDirectory: string;
}

/**
 * Resolves the Cuby data locations for a packaged Windows install.
 *
 * Installs on the C: drive keep the runtime home in the user profile. Installs
 * on another drive keep their runtime data next to the install so the data
 * follows the installation.
 */
export const resolveWindowsDataLayout = (
  options: ResolveWindowsDataLayoutOptions
): WindowsDataLayout | null => {
  if (options.platform !== "win32" || !options.isPackaged) {
    return null;
  }

  const userDataPath = win32.join(options.appDataPath, "Cuby");
  const profileRuntimeHomePath = win32.join(options.homeDirectory, ".cuby");
  const installationRoot = win32.parse(options.executablePath).root;
  const useProfileRuntimeHome = options.isWindowsStore
    || !installationRoot
    || sameWindowsRoot(installationRoot, "C:\\");
  const dataContainerPath = useProfileRuntimeHome
    ? profileRuntimeHomePath
    : win32.join(installationRoot, "CubyData");

  return {
    userDataPath,
    runtimeHomePath: useProfileRuntimeHome
      ? profileRuntimeHomePath
      : win32.join(dataContainerPath, ".cuby"),
    updatesPath: win32.join(dataContainerPath, "updates")
  };
};

const sameWindowsRoot = (left: string, right: string): boolean =>
  win32.parse(left).root.toLowerCase() === win32.parse(right).root.toLowerCase();
