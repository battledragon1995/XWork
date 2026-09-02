import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TauriCapabilities } from "@wdio/tauri-service";

type WebView2TauriCapabilities = TauriCapabilities & {
  "tauri:options": {
    application: string;
    webviewOptions: {
      userDataFolder: string;
    };
  };
};

const applicationPath = fileURLToPath(
  new URL("../../src-tauri/target/release/xwork.exe", import.meta.url),
);
const userDataFolder = join(process.env.RUNNER_TEMP ?? tmpdir(), `xwork-webview2-${process.pid}`);

const capabilities: WebView2TauriCapabilities = {
  browserName: "tauri",
  "tauri:options": {
    application: applicationPath,
    // Isolates the WebView2 profile so stale locks cannot block session creation.
    webviewOptions: {
      userDataFolder,
    },
  },
};

export const config: WebdriverIO.Config = {
  runner: "local",
  specs: ["./app-smoke.e2e.ts"],
  maxInstances: 1,
  services: [
    [
      "@wdio/tauri-service",
      {
        driverProvider: "external",
        autoInstallTauriDriver: false,
        autoDownloadEdgeDriver: true,
        startTimeout: 60_000,
      },
    ],
  ],
  capabilities: [capabilities],
  logLevel: "error",
  bail: 0,
  waitforTimeout: 15_000,
  connectionRetryTimeout: 60_000,
  connectionRetryCount: 0,
  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: {
    ui: "bdd",
    // Every command relayed through tauri-driver to WebView2 costs several seconds on Windows,
    // so a scenario with a handful of clicks needs far more than the Mocha default.
    timeout: 240_000,
  },
};
