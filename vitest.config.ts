import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Windows UI Automation integration runs only via `pnpm test:desktop:windows` (CI windows-latest).
    exclude: ["tests/**/*.integration.test.ts", "node_modules"],
    environment: "node",
    testTimeout: 30_000,
    setupFiles: ["tests/setup.ts"],
  },
});
