import { getVersion } from "@tauri-apps/api/app";
import { arch, platform, version } from "@tauri-apps/plugin-os";

/** Application and operating-system facts shown by the About page. */
export interface AppInfo {
  appVersion: string;
  osPlatform: string;
  osVersion: string;
  osArch: string;
}

/** Read every About fact atomically so the page never displays a partial result. */
export async function readAppInfo(): Promise<AppInfo> {
  const [appVersion, osPlatform, osVersion, osArch] = await Promise.all([
    getVersion(),
    platform(),
    version(),
    arch(),
  ]);

  return { appVersion, osPlatform, osVersion, osArch };
}
