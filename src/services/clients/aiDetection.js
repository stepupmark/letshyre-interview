import axios from "axios";

const TIMEOUT_MS = 10_000;

/**
 * Client for the AI detection service. It lives on its own origin and takes no
 * bearer token — sending one would force a CORS preflight it doesn't allow.
 *
 * Content-Type is deliberately unset so axios can infer it: JSON for plain
 * bodies, multipart with a correct boundary for FormData.
 */
export const aiDetectionClient = axios.create({
  baseURL: import.meta.env.VITE_AI_DETECTION_URL,
  timeout: TIMEOUT_MS,
});
