/**
 * Supported interview languages. `dir` drives document direction (RTL for
 * Arabic); `fontImport` is a dynamic import path loaded lazily so every
 * candidate isn't shipped every script's font file.
 */
export const LANGUAGES = [
  { code: "en", label: "English", nativeLabel: "English", dir: "ltr", fontImport: null },
  {
    code: "hi",
    label: "Hindi",
    nativeLabel: "हिन्दी",
    dir: "ltr",
    fontImport: () => import("@fontsource/noto-sans-devanagari/400.css"),
  },
  {
    code: "te",
    label: "Telugu",
    nativeLabel: "తెలుగు",
    dir: "ltr",
    fontImport: () => import("@fontsource/noto-sans-telugu/400.css"),
  },
  {
    code: "ta",
    label: "Tamil",
    nativeLabel: "தமிழ்",
    dir: "ltr",
    fontImport: () => import("@fontsource/noto-sans-tamil/400.css"),
  },
  {
    code: "ja",
    label: "Japanese",
    nativeLabel: "日本語",
    dir: "ltr",
    fontImport: () => import("@fontsource/noto-sans-jp/400.css"),
  },
  { code: "ru", label: "Russian", nativeLabel: "Русский", dir: "ltr", fontImport: null },
  {
    code: "ar",
    label: "Arabic",
    nativeLabel: "العربية",
    dir: "rtl",
    fontImport: () => import("@fontsource/noto-sans-arabic/400.css"),
  },
  { code: "fr", label: "French", nativeLabel: "Français", dir: "ltr", fontImport: null },
  { code: "es", label: "Spanish", nativeLabel: "Español", dir: "ltr", fontImport: null },
  { code: "pt", label: "Portuguese", nativeLabel: "Português", dir: "ltr", fontImport: null },
  {
    code: "ur",
    label: "Urdu",
    nativeLabel: "اردو",
    dir: "rtl",
    fontImport: () => import("@fontsource/noto-nastaliq-urdu/400.css"),
  },
  {
    code: "bn",
    label: "Bengali",
    nativeLabel: "বাংলা",
    dir: "ltr",
    fontImport: () => import("@fontsource/noto-sans-bengali/400.css"),
  },
  { code: "de", label: "German", nativeLabel: "Deutsch", dir: "ltr", fontImport: null },
  { code: "it", label: "Italian", nativeLabel: "Italiano", dir: "ltr", fontImport: null },
  { code: "nl", label: "Dutch", nativeLabel: "Nederlands", dir: "ltr", fontImport: null },
  {
    code: "ko",
    label: "Korean",
    nativeLabel: "한국어",
    dir: "ltr",
    fontImport: () => import("@fontsource/noto-sans-kr/400.css"),
  },
  {
    code: "id",
    label: "Indonesian",
    nativeLabel: "Bahasa Indonesia",
    dir: "ltr",
    fontImport: null,
  },
  {
    code: "kn",
    label: "Kannada",
    nativeLabel: "ಕನ್ನಡ",
    dir: "ltr",
    fontImport: () => import("@fontsource/noto-sans-kannada/400.css"),
  },
  {
    code: "ml",
    label: "Malayalam",
    nativeLabel: "മലയാളം",
    dir: "ltr",
    fontImport: () => import("@fontsource/noto-sans-malayalam/400.css"),
  },
];

export const LANGUAGE_CODES = LANGUAGES.map((l) => l.code);
export const DEFAULT_LANGUAGE = "en";

export function getLanguage(code) {
  return LANGUAGES.find((l) => l.code === code) || LANGUAGES[0];
}

const loadedFonts = new Set();

export function applyDocumentAttrs(code) {
  const { dir } = getLanguage(code);
  document.documentElement.lang = code;
  document.documentElement.dir = dir;
}

export function loadFont(code) {
  const lang = getLanguage(code);
  if (!lang.fontImport || loadedFonts.has(code)) return;
  loadedFonts.add(code);
  lang.fontImport();
}
