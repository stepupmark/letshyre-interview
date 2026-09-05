import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss()],

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

  // Only needed for local dev (LAN access from other devices); never applies to `vite build`.
  server:
    command === "serve"
      ? {
          host: true,
          allowedHosts: true,
        }
      : undefined,
}));
