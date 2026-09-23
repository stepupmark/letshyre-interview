import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import fs from "fs";

// The on-device watches load MediaPipe's WASM from our own origin: the desktop
// app and the page's CSP allow no other. Copied from the installed package into
// a folder named after its version, so a cached loader never meets a newer .wasm.
const MEDIAPIPE_DIR = path.resolve("node_modules/@mediapipe/tasks-vision");
const MEDIAPIPE_VERSION = JSON.parse(
  fs.readFileSync(path.join(MEDIAPIPE_DIR, "package.json"), "utf8"),
).version;
// vision_bundle.js is MediaPipe's IIFE build, for the classic worker that runs
// the object detector.
const MEDIAPIPE_FILES = [
  "vision_bundle.js",
  "wasm/vision_wasm_internal.js",
  "wasm/vision_wasm_internal.wasm",
  "wasm/vision_wasm_nosimd_internal.js",
  "wasm/vision_wasm_nosimd_internal.wasm",
];

function copyMediapipeWasm() {
  return {
    name: "copy-mediapipe-wasm",
    buildStart() {
      const root = path.resolve("public/mediapipe/wasm");
      const to = path.join(root, MEDIAPIPE_VERSION);
      fs.mkdirSync(to, { recursive: true });
      for (const entry of fs.readdirSync(root)) {
        if (entry !== MEDIAPIPE_VERSION) {
          fs.rmSync(path.join(root, entry), { recursive: true, force: true });
        }
      }
      for (const file of MEDIAPIPE_FILES) {
        const source = path.join(MEDIAPIPE_DIR, file);
        const target = path.join(to, path.basename(file));
        const stale =
          !fs.existsSync(target) || fs.statSync(target).size !== fs.statSync(source).size;
        if (stale) fs.copyFileSync(source, target);
      }
    },
  };
}

export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss(), copyMediapipeWasm()],

  define: {
    "import.meta.env.MEDIAPIPE_VERSION": JSON.stringify(MEDIAPIPE_VERSION),
  },

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
