import { desktopVersion, isOutdatedDesktop } from "./desktopVersion";

const UA = "Mozilla/5.0 (Windows NT 10.0) Chrome/150.0 Electron/43.4.1 Safari/537.36";
const withVersion = (v) => `${UA} LetsHyreSecureInterview/${v}`;

describe("desktopVersion", () => {
  it("reads the version the app adds to its user agent", () => {
    expect(desktopVersion(withVersion("1.4.5"))).toEqual([1, 4, 5]);
    expect(desktopVersion(UA)).toBeNull();
  });
});

describe("isOutdatedDesktop", () => {
  const check = (userAgent, minVersion, isDesktop = true) =>
    isOutdatedDesktop({ userAgent, isDesktop, minVersion });

  it("lets everything through until a minimum is set", () => {
    expect(check(UA, "")).toBe(false);
    expect(check(UA, undefined)).toBe(false);
  });

  it("stops builds below the minimum, and builds too old to say", () => {
    expect(check(withVersion("1.4.4"), "1.4.5")).toBe(true);
    expect(check(withVersion("1.3.9"), "1.4.0")).toBe(true);
    expect(check(UA, "1.4.5")).toBe(true);
  });

  it("allows the minimum and anything newer", () => {
    expect(check(withVersion("1.4.5"), "1.4.5")).toBe(false);
    expect(check(withVersion("1.10.0"), "1.4.5")).toBe(false);
    expect(check(withVersion("2.0.0"), "1.9.9")).toBe(false);
  });

  it("never stops a plain browser", () => {
    expect(check(UA, "1.4.5", false)).toBe(false);
  });
});
