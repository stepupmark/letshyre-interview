// Reads proctoring logs in whatever shape they turn up: the batch the site
// submits, its `records` array, several batches, or bare /detect responses.
// Plain JS with no aliases, so scripts/shadow-report.js can import it from Node.

export const KINDS = [
  "frame",
  "decision",
  "identity",
  "electron",
  "window",
  "disconnect",
  "failure",
  "sampling",
  "end",
  "app",
];

const isBatch = (value) =>
  value && typeof value === "object" && Array.isArray(value.payload?.records);

const isDetectResponse = (value) =>
  value &&
  typeof value === "object" &&
  !value.event_type &&
  ("objects_detected" in value || "face_detected" in value);

function asRecord(value) {
  return isDetectResponse(value)
    ? { timestamp: null, source: "cv_detect", event_type: "frame", payload: value }
    : value;
}

/** @returns {{ interview_id?: string, session_id?: string, records: object[] }[]} */
export function extractSessions(json, name = "log") {
  if (isBatch(json)) {
    return [
      {
        interview_id: json.interview_id,
        session_id: json.session_id ?? name,
        records: json.payload.records.map(asRecord),
      },
    ];
  }
  if (json && Array.isArray(json.records)) {
    return [{ session_id: json.session_id ?? name, records: json.records.map(asRecord) }];
  }
  if (Array.isArray(json)) {
    if (json.length && json.every(isBatch)) {
      return json.flatMap((batch, i) => extractSessions(batch, `${name}#${i + 1}`));
    }
    return [{ session_id: name, records: json.map(asRecord) }];
  }
  throw new Error("Not a proctoring log: expected a batch, a records array or detect responses");
}

function kindOf(record) {
  const p = record.payload ?? {};
  switch (record.event_type) {
    case "frame":
    case "verified_frame":
      return "frame";
    case "detection_failure":
      return "failure";
    case "suspicion_sampling":
      return "sampling";
    case "violation_decision":
      break;
    default:
      return "decision";
  }
  if (p.type === "INTERVIEW_ENDED") return "end";
  if (p.type === "NETWORK_DISCONNECT") return "disconnect";
  if (p.source === "electron") return "electron";
  if (p.category === "window") return "window";
  if (p.category === "identity") return "identity";
  return "decision";
}

/** The shadow rule or label a decision belongs to, as VITE_AI_SHADOW_* names them. */
export function shadowRuleOf(payload = {}) {
  if (payload.label) return `label:${payload.label}`;
  if (payload.type === "LOOKING_AWAY") return "gaze";
  if (
    (payload.type === "NO_FACE" || payload.type === "MULTIPLE_FACES") &&
    payload.seen_by === "verify"
  ) {
    return "verify_faces";
  }
  return `type:${payload.type ?? "unknown"}`;
}

const round = (n) => (typeof n === "number" ? Math.round(n * 100) / 100 : n);

function frameSummary(p) {
  const parts = [];
  if (p.trigger) parts.push(`trigger=${p.trigger}`);
  if (p.verify_only || p.verified_faces !== undefined) parts.push(`verify=${p.verified_faces}`);
  if (p.face_detected !== undefined) parts.push(`faces=${p.face_detected ? p.face_count : 0}`);
  if (p.local_faces) parts.push(`local=${p.local_faces}`);
  const objects = (p.objects_detected ?? []).map((o) => `${o.label} ${round(o.confidence)}`);
  if (objects.length) parts.push(objects.join(", "));
  if (p.detect_ms != null) parts.push(`${p.detect_ms}ms`);
  return parts.join(" · ");
}

function decisionSummary(p) {
  const parts = [p.outcome];
  if (p.label) parts.push(p.label);
  if (p.seen_by) parts.push(`seen_by=${p.seen_by}`);
  if (p.confidence != null) parts.push(`conf=${round(p.confidence)}`);
  if (p.area_ratio != null) parts.push(`area=${Number(p.area_ratio.toFixed(4))}`);
  if (p.similarity != null) parts.push(`sim=${round(p.similarity)}`);
  if (p.window) parts.push(`window=${p.window.hits ?? "?"}/${p.window.size ?? "?"}`);
  if (p.code) parts.push(`code=${p.code}`);
  if (p.apps?.length) parts.push(p.apps.join(", "));
  if (p.reason) parts.push(`reason=${p.reason}`);
  if (p.away_ms != null) parts.push(`away=${p.away_ms}ms`);
  if (p.offline_ms != null) parts.push(`offline=${p.offline_ms}ms`);
  if (p.counts_as_strike) parts.push(`strike ${p.strike_count ?? ""}`.trim());
  return parts.filter(Boolean).join(" · ");
}

export function normalizeRecord(record, index = 0) {
  const p = record.payload ?? {};
  const kind = kindOf(record);
  const at = record.timestamp ? Date.parse(record.timestamp) : null;
  const base = { id: `r${index}`, index, at: Number.isNaN(at) ? null : at, kind, raw: record };

  if (kind === "frame") {
    return {
      ...base,
      rule: p.trigger ?? "frame",
      title: record.event_type === "verified_frame" ? "verified frame" : "frame",
      summary: frameSummary(p),
      strike: false,
    };
  }
  if (kind === "failure") {
    return {
      ...base,
      rule: "detection_failure",
      title: "detection failed",
      summary: `${p.reason ?? ""} (${p.consecutive ?? "?"} in a row)`,
      strike: false,
    };
  }
  if (kind === "sampling") {
    return {
      ...base,
      rule: "suspicion",
      title: "sampling faster",
      summary: p.reason,
      strike: false,
    };
  }
  return {
    ...base,
    rule: p.label ? `${p.type}:${p.label}` : (p.type ?? record.event_type ?? "unknown"),
    title: p.type ?? record.event_type ?? "record",
    outcome: p.outcome,
    summary: decisionSummary(p),
    strike: p.counts_as_strike === true,
  };
}

// The desktop app writes `[ISO] [LEVEL] [tag] message`; other lines join the one above.
const APP_LINE = /^\[(\d{4}-\d{2}-\d{2}T[^\]]+)\]\s+\[(\w+)\]\s+(?:\[([^\]]+)\]\s*)?(.*)$/;

export function parseAppLog(text) {
  const entries = [];
  for (const line of String(text).split(/\r?\n/)) {
    const match = line.match(APP_LINE);
    if (match) {
      const [, time, level, tag, message] = match;
      const at = Date.parse(time);
      entries.push({
        id: `a${entries.length}`,
        index: entries.length,
        at: Number.isNaN(at) ? null : at,
        kind: "app",
        rule: tag ?? "app",
        title: `app ${level.toLowerCase()}`,
        level: level.toLowerCase(),
        summary: message,
        strike: false,
        raw: line,
      });
    } else if (line.trim() && entries.length) {
      const last = entries[entries.length - 1];
      last.summary += `\n${line}`;
      last.raw += `\n${line}`;
    }
  }
  return entries;
}

/** One list, oldest first. Records without a time keep their place after the ones before them. */
export function buildTimeline({ log, appLog } = {}) {
  const sessions = log ? extractSessions(log) : [];
  const records = sessions.flatMap((session, s) =>
    session.records.map((record, i) => ({
      ...normalizeRecord(record, i),
      id: `s${s}r${i}`,
      session: session.session_id,
    })),
  );
  const app = appLog ? parseAppLog(appLog) : [];

  let lastAt = -Infinity;
  const withSortKey = [...records, ...app].map((entry, order) => {
    if (entry.at !== null) lastAt = entry.at;
    return { entry, key: entry.at ?? lastAt, order };
  });
  withSortKey.sort((a, b) => a.key - b.key || a.order - b.order);
  return withSortKey.map(({ entry }) => entry);
}

export function filterTimeline(entries, { kinds, rule = "", strikesOnly = false } = {}) {
  const needle = rule.trim().toLowerCase();
  return entries.filter(
    (entry) =>
      (!kinds || kinds.has(entry.kind)) &&
      (!strikesOnly || entry.strike) &&
      (!needle ||
        entry.rule.toLowerCase().includes(needle) ||
        entry.title.toLowerCase().includes(needle)),
  );
}
