import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],

  resolve: {
    alias: {
      "@": path.resolve("src"),
      "@components": path.resolve("src/components"),
      "@pages": path.resolve("src/pages"),
      "@router": path.resolve("src/router"),
      "@hooks": path.resolve("src/hooks"),
      "@queries": path.resolve("src/queries"),
      "@mutations": path.resolve("src/mutations"),
      "@lib": path.resolve("src/lib"),
      "@services": path.resolve("src/services"),
    },
  },

  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.js"],
    pool: "threads",
  },
});
