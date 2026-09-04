/**
 * Lightweight env-gated logger.
 *
 * `log`/`warn`/`debug` are silenced in production builds to keep the console
 * clean and avoid leaking interview/proctoring details (and the noise from the
 * 5s detection loop). `error` always logs so real failures stay visible.
 *
 * Enable verbose logs in a production build by setting VITE_DEBUG_LOGS=true.
 */
const enabled = import.meta.env.DEV || import.meta.env.VITE_DEBUG_LOGS === "true";

export const logger = {
  log: (...args) => {
    if (enabled) console.log(...args);
  },
  warn: (...args) => {
    if (enabled) console.warn(...args);
  },
  debug: (...args) => {
    if (enabled) console.debug(...args);
  },
  error: (...args) => console.error(...args),
};
