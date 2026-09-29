import fs from "node:fs";
import path from "node:path";
import detectFrames from "@hooks/proctoring/__fixtures__/detectionLog.json";
import batch from "./__fixtures__/proctoringBatch.json";
import {
  buildTimeline,
  extractSessions,
  filterTimeline,
  normalizeRecord,
  parseAppLog,
  shadowRuleOf,
} from "./proctoringLog";

const appLog = fs.readFileSync(path.resolve("src/dev/__fixtures__/app-log.txt"), "utf8");

describe("extractSessions", () => {
  it("reads the batch the site submits", () => {
    const [session] = extractSessions(batch);
    expect(session.session_id).toBe("sess-demo-1");
    expect(session.records).toHaveLength(batch.payload.total_records);
  });

  it("reads a bare records array, several batches, and raw detect responses", () => {
    expect(extractSessions(batch.payload.records, "x")[0].records).toHaveLength(
      batch.payload.total_records,
    );
    const two = extractSessions([batch, { ...batch, session_id: "other" }]);
    expect(two.map((s) => s.session_id)).toEqual(["sess-demo-1", "other"]);

    const [raw] = extractSessions(detectFrames, "detect");
    expect(raw.records).toHaveLength(detectFrames.length);
    expect(raw.records.every((r) => r.event_type === "frame")).toBe(true);
  });

  it("refuses something that isn't a log", () => {
    expect(() => extractSessions({ hello: 1 })).toThrow(/Not a proctoring log/);
  });
});

describe("normalizeRecord", () => {
  const records = batch.payload.records;
  const find = (fn) => normalizeRecord(records.find(fn));

  it("summarises a frame with its trigger and objects", () => {
    const frame = find((r) => r.event_type === "frame" && r.payload.trigger === "burst");
    expect(frame.kind).toBe("frame");
    expect(frame.rule).toBe("burst");
    expect(frame.summary).toMatch(/trigger=burst/);
    expect(frame.summary).toMatch(/laptop 0\.89/);
  });

  it("shows why a decision went the way it did", () => {
    const shadow = find((r) => r.payload.outcome === "shadow" && r.payload.seen_by === "verify");
    expect(shadow).toMatchObject({ kind: "decision", title: "NO_FACE", outcome: "shadow" });
    expect(shadow.summary).toMatch(/seen_by=verify/);
    expect(shadow.summary).toMatch(/window=2\/3/);
  });

  it("marks strikes, electron, window, disconnect and end records", () => {
    const kinds = records.map((r) => normalizeRecord(r));
    const strikes = kinds.filter((e) => e.strike);
    expect(strikes.map((e) => e.title)).toEqual(["PROHIBITED_OBJECT", "ELECTRON_EXTERNALDISPLAY"]);
    expect(strikes.map((e) => e.kind)).toEqual(["decision", "electron"]);
    const byKind = new Set(kinds.map((e) => e.kind));
    for (const kind of [
      "frame",
      "electron",
      "window",
      "disconnect",
      "end",
      "failure",
      "sampling",
    ]) {
      expect(byKind).toContain(kind);
    }
    expect(kinds.at(-1)).toMatchObject({ kind: "end", outcome: "terminated" });
  });

  it("gives raw detect responses a frame entry with no time", () => {
    const [raw] = extractSessions(detectFrames);
    const entry = normalizeRecord(raw.records[3]);
    expect(entry).toMatchObject({ kind: "frame", at: null });
    expect(entry.summary).toMatch(/cell phone 0\.66/);
  });
});

describe("shadowRuleOf", () => {
  it("names rules the way VITE_AI_SHADOW_* does", () => {
    expect(shadowRuleOf({ type: "PROHIBITED_OBJECT", label: "tv" })).toBe("label:tv");
    expect(shadowRuleOf({ type: "LOOKING_AWAY" })).toBe("gaze");
    expect(shadowRuleOf({ type: "NO_FACE", seen_by: "verify" })).toBe("verify_faces");
    expect(shadowRuleOf({ type: "NO_FACE", seen_by: "detect" })).toBe("type:NO_FACE");
  });
});

describe("parseAppLog", () => {
  it("reads the desktop app's lines and folds continuation lines in", () => {
    const entries = parseAppLog(appLog);
    expect(entries).toHaveLength(5);
    expect(entries[1]).toMatchObject({ kind: "app", level: "warn", rule: "systemChecks" });
    expect(entries[3].summary).toMatch(/carried on/);
  });
});

describe("buildTimeline", () => {
  it("merges the log and the app log in time order", () => {
    const timeline = buildTimeline({ log: batch, appLog });
    const times = timeline.map((e) => e.at);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(timeline[0].kind).toBe("app");
    const display = timeline.findIndex((e) => e.title === "ELECTRON_EXTERNALDISPLAY");
    expect(timeline[display + 1]).toMatchObject({ kind: "app", level: "warn" });
  });

  it("keeps raw detect responses in the order they came", () => {
    const timeline = buildTimeline({ log: detectFrames });
    expect(timeline.map((e) => e.index)).toEqual(detectFrames.map((_, i) => i));
  });

  it("filters by kind, rule and strikes", () => {
    const timeline = buildTimeline({ log: batch, appLog });
    expect(filterTimeline(timeline, { kinds: new Set(["app"]) })).toHaveLength(5);
    expect(filterTimeline(timeline, { strikesOnly: true })).toHaveLength(2);
    const gaze = filterTimeline(timeline, { rule: "looking_away" });
    expect(gaze).toHaveLength(2);
    expect(filterTimeline(timeline, { rule: "tv" }).every((e) => /tv/i.test(e.rule))).toBe(true);
  });
});
