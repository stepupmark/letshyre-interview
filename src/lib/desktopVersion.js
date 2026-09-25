// The desktop app adds "LetsHyreSecureInterview/<version>" to its user agent.
// Builds from before that can't be told apart, so they count as too old.
const TOKEN = /LetsHyreSecureInterview\/(\d+)\.(\d+)\.(\d+)/;

function parse(version) {
  const match = String(version || "").match(/^(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1, 4).map(Number) : null;
}

export function desktopVersion(userAgent) {
  const match = String(userAgent || "").match(TOKEN);
  return match ? match.slice(1, 4).map(Number) : null;
}

function below(have, min) {
  for (let i = 0; i < 3; i += 1) {
    if (have[i] !== min[i]) return have[i] < min[i];
  }
  return false;
}

/**
 * @param {{ userAgent: string, isDesktop: boolean, minVersion: string }} options
 * @returns {boolean} whether this desktop app must be updated before the interview
 */
export function isOutdatedDesktop({ userAgent, isDesktop, minVersion }) {
  const min = parse(minVersion);
  if (!isDesktop || !min) return false;
  const have = desktopVersion(userAgent);
  return !have || below(have, min);
}
