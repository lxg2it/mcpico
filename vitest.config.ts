import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/index.ts"],
      thresholds: {
        // startServer() is I/O orchestration (connect/discover/register/transport)
        // — requires integration tests, not unit tests. Pure logic functions are
        // extracted and fully tested. SSE/HTTP transport code is also I/O.
        statements: 67,
        branches: 68,
        functions: 80,
        lines: 66,
      },
    },
  },
});
