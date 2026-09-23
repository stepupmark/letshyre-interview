import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import fs from "fs";

// The on-device face watch loads MediaPipe's WASM from our own origin: the
// desktop app and the page's CSP allow no other. Copied from the installed
// package so its version always matches the JS that loads it.
const MEDIAPIPE_WASM = ["vision_wasm_internal", "vision_wasm_nosimd_internal"];

function copyMediapipeWasm() {
  return {
    name: "copy-mediapipe-wasm",
    buildStart() {
      const from = path.resolve("node_modules/@mediapipe/tasks-vision/wasm");
      const to = path.resolve("public/mediapipe/wasm");
      fs.mkdirSync(to, { recursive: true });
      for (const name of MEDIAPIPE_WASM) {
        for (const ext of [".js", ".wasm"]) {
          const source = path.join(from, name + ext);
          const target = path.join(to, name + ext);
          const stale =
            !fs.existsSync(target) || fs.statSync(target).size !== fs.statSync(source).size;
          if (stale) fs.copyFileSync(source, target);
        }
      }
    },
  };
}

export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss(), copyMediapipeWasm()],

  resolve: {
    alias: {
      "@": path.resolve("src"),
      "@components": path.resolve("src/components"),
      "@pages": path.resolve("src/pages"),
      "@router": path.resolve("src/router"),
      "@hooks": path.resolve("src/hooks"),
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
