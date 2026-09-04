import { DEFAULT_LANGUAGE, LANGUAGE_CODES } from "./languages";

export const STORAGE_KEY = "interview_language";

// i18n/index.js resolves this synchronously at module load, before Electron's
// dom-ready write can land — so sessionStorage.locale is a best-effort
// fallback, and ?lang= (attached fresh on every launch) is what actually wins.
export function resolveInitialLanguage(
  search = window.location.search,
  storage = window.sessionStorage,
) {
  const normalize = (v) => v?.toLowerCase();
  const fromUrl = normalize(new URLSearchParams(search).get("lang"));
  const fromElectronSession = normalize(storage.getItem("locale"));
  const fromOwnSession = storage.getItem(STORAGE_KEY);

  const resolved =
    [fromUrl, fromElectronSession].find((code) => LANGUAGE_CODES.includes(code)) ||
    fromOwnSession ||
    DEFAULT_LANGUAGE;

  if (resolved !== fromOwnSession) {
    storage.setItem(STORAGE_KEY, resolved);
  }
  return resolved;
}
