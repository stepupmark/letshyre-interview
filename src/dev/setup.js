import { createElement } from "react";
import { createRoot } from "react-dom/client";
import {
  createFakeDesktop,
  desktopUserAgent,
  DEVTOOLS_MARKER,
  readDesktopSettings,
} from "./fakeDesktop";

export const TIMELINE_PATH = "/__dev/timeline";

function installFakeDesktop(settings) {
  const { api, controls } = createFakeDesktop({
    abortInterview: settings.abortInterview,
    onLog: (entry) => console.debug("[fake desktop]", entry.name, ...entry.args),
  });
  window.electronAPI = api;

  const agent = desktopUserAgent(navigator.userAgent, settings.version);
  Object.defineProperty(navigator, "userAgent", { get: () => agent, configurable: true });

  const host = document.createElement("div");
  host.id = DEVTOOLS_MARKER;
  document.body.appendChild(host);
  import("./FakeDesktopPanel.jsx").then(({ default: FakeDesktopPanel }) => {
    createRoot(host).render(createElement(FakeDesktopPanel, { controls, settings }));
  });
}

// A photo so face registration runs, and tokens so /interview opens straight away.
const MOCK_PHOTO = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP8=";

function prepareMockBackend(search) {
  const scenario = new URLSearchParams(search).get("scenario");
  if (scenario) document.cookie = `mock_scenario=${encodeURIComponent(scenario)}; path=/`;
  if (!sessionStorage.getItem("ac")) sessionStorage.setItem("ac", "mock-access");
  if (!sessionStorage.getItem("rc")) sessionStorage.setItem("rc", "mock-refresh");
  if (!sessionStorage.getItem("candidate_photo")) {
    sessionStorage.setItem("candidate_photo", MOCK_PHOTO);
  }
  const current = document.cookie.match(/(?:^|; )mock_scenario=([^;]*)/)?.[1] ?? "normal";
  console.info(`[mock api] scenario: ${decodeURIComponent(current)}`);
}

/** Runs before the app mounts. Returns a page to render instead of the app, or null. */
export async function setupDevTools() {
  window.__letshyreDevtools = DEVTOOLS_MARKER;
  const { search, pathname } = window.location;

  if (pathname.startsWith(TIMELINE_PATH)) {
    const { default: TimelinePage } = await import("./timeline/TimelinePage.jsx");
    return TimelinePage;
  }

  if (import.meta.env.MODE === "mock") prepareMockBackend(search);

  const desktop = readDesktopSettings(search);
  if (desktop) installFakeDesktop(desktop);
  return null;
}
