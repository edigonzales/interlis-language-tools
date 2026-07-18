import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: [
        "src/cache.ts",
        "src/compiler.ts",
        "src/features.ts",
        "src/interactions.ts",
        "src/repository.ts",
        "src/service.ts",
        "src/workspace.ts",
      ],
      thresholds: {
        statements: 90,
        lines: 90,
        functions: 90,
        branches: 85,
      },
    },
  },
});
