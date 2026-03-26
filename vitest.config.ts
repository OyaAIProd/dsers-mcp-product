import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globals: true,
  },
  resolve: {
    extensions: [".ts", ".js"],
    alias: {
      // Allow importing .js extensions from .ts source files
    },
  },
  esbuild: {
    target: "node22",
  },
});
