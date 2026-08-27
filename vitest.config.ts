import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "e2e",
          include: ["tests/e2e/**/*.test.ts"],
          // Every e2e test drives a real browser against a real build.
          globalSetup: ["tests/e2e/support/build.ts"],
          testTimeout: 60_000,
          hookTimeout: 120_000,
          // One browser at a time keeps the output readable and the box calm.
          fileParallelism: false,
        },
      },
    ],
  },
});
