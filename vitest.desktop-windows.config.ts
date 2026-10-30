/**
 * Dedicated config for Windows UI Automation integration tests.
 * Default vitest.config.ts excludes *.integration.test.ts so unit CI stays fast/portable.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/desktop-windows.integration.test.ts"],
    environment: "node",
    testTimeout: 90_000,
    setupFiles: ["tests/setup.ts"],
  },
});
