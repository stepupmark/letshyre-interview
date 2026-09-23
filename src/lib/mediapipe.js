// Served from our own origin: the page's CSP and the desktop app allow no
// other. The WASM is about 12 MB, so it loads on first use, never with the app.
const BASE = `${import.meta.env.BASE_URL}mediapipe`;

export const WASM_BASE = `${BASE}/wasm/${import.meta.env.MEDIAPIPE_VERSION}`;

export const modelPath = (name) => `${BASE}/models/${name}`;

// Every detector fetches the WASM itself. Creating them one at a time lets the
// second find it in the HTTP cache instead of downloading it alongside the first.
let creating = Promise.resolve();

/**
 * Wraps `create()` so every caller shares one detector. A failed load is tried
 * again by the next interview rather than cached.
 */
export function sharedDetector(create) {
  let loading = null;
  return () => {
    if (loading) return loading;
    loading = creating.then(create);
    creating = loading.catch(() => {});
    loading.catch(() => {
      loading = null;
    });
    return loading;
  };
}
