import { fileURLToPath } from "node:url";
import type { TauriCapabilities } from "@wdio/tauri-service";

const applicationPath = fileURLToPath(
  new URL("../../src-tauri/target/release/xwork.exe", import.meta.url),
);

const capabilities: TauriCapabilities = {
  browserName: "tauri",
  "tauri:options": {
    application: applicationPath,
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
    timeout: 60_000,
  },
};
