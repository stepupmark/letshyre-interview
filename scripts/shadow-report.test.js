import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import detectFrames from "../src/hooks/proctoring/__fixtures__/detectionLog.json";
import batch from "../src/dev/__fixtures__/proctoringBatch.json";
import { formatReport, shadowReport } from "./shadow-report.js";

const FIXTURE = path.resolve("src/dev/__fixtures__/proctoringBatch.json");

const withoutStrikes = {
  ...batch,
  session_id: "clean",
  payload: {
    ...batch.payload,
    records: batch.payload.records.filter((r) => !r.payload?.counts_as_strike),
  },
};

describe("shadowReport", () => {
  it("reports each shadow rule and label in the fixture", () => {
    const report = shadowReport([{ name: "batch", json: batch }]);
    const rows = Object.fromEntries(report.rules.map((r) => [r.rule, r]));

    expect(Object.keys(rows).sort()).toEqual(["gaze", "label:tv", "verify_faces"]);
    expect(rows.gaze).toMatchObject({ sessions: 1, records: 2, wouldBeStrikes: 2 });
    // The two tv records are 12s apart: one strike under the cooldown.
    expect(rows["label:tv"]).toMatchObject({ records: 2, wouldBeStrikes: 1 });
    expect(rows.gaze.examples[0]).toBe("sess-demo-1 @ 2026-09-20T10:00:18.000Z");
  });

  it("counts a would-be termination only when the shadow strikes reach the limit", () => {
    const report = shadowReport(
      [
        { name: "a", json: batch },
        { name: "b", json: withoutStrikes },
      ],
      { max: 3 },
    );
    const gaze = report.rules.find((r) => r.rule === "gaze");
    expect(report.sessions).toBe(2);
    expect(gaze.sessions).toBe(2);
    // Two real strikes plus gaze ends the first; gaze alone can't end the clean one.
    expect(gaze.wouldBeTerminations).toBe(1);
    expect(report.combinedTerminationsUpperBound).toBe(2);
  });

  it("finds nothing in raw detect responses", () => {
    const report = shadowReport([{ name: "detect", json: detectFrames }]);
    expect(report.rules).toEqual([]);
    expect(formatReport(report)).toMatch(/No shadow records/);
  });

  it("prints a table from the command line", () => {
    const out = execFileSync(
      process.execPath,
      ["scripts/shadow-report.js", FIXTURE, "--max", "3"],
      {
        encoding: "utf8",
      },
    );
    expect(out).toMatch(/1 session\(s\), MAX_VIOLATIONS=3/);
    expect(out).toMatch(/^gaze\s+1\s+2\s+2\s+1\s*$/m);
  });
});
