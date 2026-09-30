/**
 * Supported interview languages. `dir` drives document direction (RTL for
 * Arabic); `fontImport` is a dynamic import path loaded lazily so every
 * candidate isn't shipped every script's font file.
 */
export const LANGUAGES = [
  { code: "en", dir: "ltr", fontImport: null },
  {
    code: "hi",
    dir: "ltr",
    fontImport: () => import("@fontsource/noto-sans-devanagari/400.css"),
  },
  {
    code: "te",
    dir: "ltr",
    fontImport: () => import("@fontsource/noto-sans-telugu/400.css"),
  },
  {
    code: "ta",
    dir: "ltr",
    fontImport: () => import("@fontsource/noto-sans-tamil/400.css"),
  },
  {
    code: "ja",
    dir: "ltr",
    fontImport: () => import("@fontsource/noto-sans-jp/400.css"),
  },
  { code: "ru", dir: "ltr", fontImport: null },
  {
    code: "ar",
    dir: "rtl",
    fontImport: () => import("@fontsource/noto-sans-arabic/400.css"),
  },
  { code: "fr", dir: "ltr", fontImport: null },
  { code: "es", dir: "ltr", fontImport: null },
  { code: "pt", dir: "ltr", fontImport: null },
  {
    code: "ur",
    dir: "rtl",
    fontImport: () => import("@fontsource/noto-nastaliq-urdu/400.css"),
  },
  {
    code: "bn",
    dir: "ltr",
    fontImport: () => import("@fontsource/noto-sans-bengali/400.css"),
  },
  { code: "de", dir: "ltr", fontImport: null },
  { code: "it", dir: "ltr", fontImport: null },
  { code: "nl", dir: "ltr", fontImport: null },
  {
    code: "ko",
    dir: "ltr",
    fontImport: () => import("@fontsource/noto-sans-kr/400.css"),
  },
  {
    code: "id",
    dir: "ltr",
    fontImport: null,
  },
  {
    code: "kn",
    dir: "ltr",
    fontImport: () => import("@fontsource/noto-sans-kannada/400.css"),
  },
  {
    code: "ml",
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
