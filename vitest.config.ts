import { defineConfig } from "vitest/config";

// Unit tests run in plain Node: they cover src/core and the agent loop
// with fake models and tools, so no Workers runtime is needed.
export default defineConfig({
  test: { include: ["test/**/*.test.ts"] },
});
