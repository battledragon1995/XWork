import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Configure the SPA build, source alias, and jsdom-based component tests.
export default defineConfig({
  clearScreen: false,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    // The CodeMirror-backed viewer suites transform several megabytes of grammar packages,
    // which starves the parallel jsdom workers running userEvent-driven cases. Every suite
    // still settles well inside this budget; only the default 5s ceiling was too tight.
    testTimeout: 15_000,
  },
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
