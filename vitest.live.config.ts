import { defineConfig } from "vitest/config";

// Live searches against real APIs; uses quota. Run with `npm run test:live`.
export default defineConfig({
  test: { include: ["test/live/**/*.test.ts"], fileParallelism: false },
});
