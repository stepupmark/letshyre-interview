#!/usr/bin/env node
// What shadowed rules and labels would have done had they been enforced.
//   pnpm shadow:report <log.json...> [--max 3] [--cooldown 30] [--json]

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { extractSessions, shadowRuleOf } from "../src/dev/proctoringLog.js";

const EXAMPLES = 3;

function sessionFacts(session) {
  let strikes = 0;
  let endedBy = null;
  const shadows = [];
  for (const record of session.records) {
    if (record.event_type !== "violation_decision") continue;
    const p = record.payload ?? {};
    if (p.counts_as_strike) strikes = Math.max(strikes + 1, p.strike_count ?? 0);
    if (p.type === "INTERVIEW_ENDED") endedBy = p.reason ?? p.outcome ?? endedBy;
    if (p.outcome === "shadow") {
      shadows.push({
        rule: shadowRuleOf(p),
        at: record.timestamp ? Date.parse(record.timestamp) : null,
      });
    }
  }
  return { strikes, endedBy, shadows };
}

// A strike policy cooldown stops one held condition striking on every frame,
// so shadow records closer together than this count once.
function wouldBeStrikes(shadows, cooldownMs) {
  let last = -Infinity;
  let count = 0;
  for (const { at } of shadows) {
    if (at === null || at - last >= cooldownMs) {
      count += 1;
      if (at !== null) last = at;
    }
  }
  return count;
}

/**
 * @param {{ name: string, json: unknown }[]} logs
 * @param {{ max?: number, cooldownSeconds?: number }} [options]
 */
export function shadowReport(logs, { max = 3, cooldownSeconds = 30 } = {}) {
  const cooldownMs = cooldownSeconds * 1000;
  const sessions = logs.flatMap(({ name, json }) =>
    extractSessions(json, name).map((session) => ({ ...session, ...sessionFacts(session) })),
  );
  const rules = new Map();

  for (const session of sessions) {
    const byRule = new Map();
    for (const shadow of session.shadows) {
      byRule.set(shadow.rule, [...(byRule.get(shadow.rule) ?? []), shadow]);
    }
    for (const [rule, shadows] of byRule) {
      const row = rules.get(rule) ?? {
        rule,
        records: 0,
        sessions: 0,
        wouldBeStrikes: 0,
        wouldBeTerminations: 0,
        examples: [],
      };
      const strikes = wouldBeStrikes(shadows, cooldownMs);
      row.records += shadows.length;
      row.sessions += 1;
      row.wouldBeStrikes += strikes;
      if (session.strikes < max && session.strikes + strikes >= max) row.wouldBeTerminations += 1;
      for (const { at } of shadows) {
        if (row.examples.length >= EXAMPLES) break;
        row.examples.push(
          `${session.session_id} @ ${at === null ? "?" : new Date(at).toISOString()}`,
        );
      }
      rules.set(rule, row);
    }
  }

  const combined = sessions.filter(
    (s) => s.strikes < max && s.strikes + s.shadows.length >= max,
  ).length;

  return {
    max,
    cooldownSeconds,
    sessions: sessions.length,
    rules: [...rules.values()].sort((a, b) => b.wouldBeStrikes - a.wouldBeStrikes),
    combinedTerminationsUpperBound: combined,
  };
}

export function formatReport(report) {
  const lines = [
    `${report.sessions} session(s), MAX_VIOLATIONS=${report.max}, one strike per ${report.cooldownSeconds}s per rule`,
  ];
  if (!report.rules.length) {
    lines.push("No shadow records.");
    return lines.join("\n");
  }
  const header = ["rule", "sessions", "records", "would-be strikes", "would-be terminations"];
  const rows = report.rules.map((r) => [
    r.rule,
    String(r.sessions),
    String(r.records),
    String(r.wouldBeStrikes),
    String(r.wouldBeTerminations),
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i].length)));
  const fmt = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join("  ");
  lines.push("", fmt(header), fmt(widths.map((w) => "-".repeat(w))), ...rows.map(fmt));
  lines.push("", "Examples:");
  for (const r of report.rules) lines.push(`  ${r.rule}: ${r.examples.join(", ")}`);
  lines.push(
    "",
    `Every shadow record enforced at once (no cooldown) would end ${report.combinedTerminationsUpperBound} session(s) at most.`,
  );
  return lines.join("\n");
}

function parseArgs(argv) {
  const options = { files: [], max: Number(process.env.VITE_AI_MAX_VIOLATIONS_ALLOWED) || 3 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--max") options.max = Number(argv[++i]);
    else if (arg === "--cooldown") options.cooldownSeconds = Number(argv[++i]);
    else if (arg === "--json") options.json = true;
    else options.files.push(arg);
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.files.length) {
    console.error("usage: pnpm shadow:report <log.json...> [--max 3] [--cooldown 30] [--json]");
    process.exit(1);
  }
  const logs = options.files.map((file) => ({
    name: path.basename(file),
    json: JSON.parse(fs.readFileSync(file, "utf8")),
  }));
  const report = shadowReport(logs, options);
  console.log(options.json ? JSON.stringify(report, null, 2) : formatReport(report));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}
