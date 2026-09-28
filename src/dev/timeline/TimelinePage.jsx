import { useMemo, useState } from "react";
import { buildTimeline, filterTimeline, KINDS } from "../proctoringLog";

// Inline styles: Tailwind would scan this file and ship its classes in the production CSS.
const COLORS = {
  frame: "#64748b",
  decision: "#2563eb",
  identity: "#7c3aed",
  electron: "#c2410c",
  window: "#0891b2",
  disconnect: "#ca8a04",
  failure: "#dc2626",
  sampling: "#94a3b8",
  end: "#111827",
  app: "#059669",
};
const PAGE = 1500;

const page = {
  minHeight: "100vh",
  padding: 16,
  font: "13px/1.45 ui-monospace, Menlo, Consolas, monospace",
  color: "#0f172a",
  background: "#f8fafc",
};
const panel = {
  display: "flex",
  gap: 12,
  flexWrap: "wrap",
  alignItems: "center",
  marginBottom: 12,
};
const textarea = { width: "100%", minHeight: 90, font: "inherit", padding: 6 };

function formatTime(at, first) {
  if (at === null) return "—";
  const iso = new Date(at).toISOString().slice(11, 23);
  return first === null ? iso : `${iso} +${((at - first) / 1000).toFixed(1)}s`;
}

async function readFiles(files) {
  const read = { log: null, appLog: null, names: [] };
  for (const file of files) {
    const text = await file.text();
    read.names.push(file.name);
    try {
      read.log = JSON.parse(text);
    } catch {
      read.appLog = read.appLog ? `${read.appLog}\n${text}` : text;
    }
  }
  return read;
}

export default function TimelinePage() {
  const [log, setLog] = useState(null);
  const [appLog, setAppLog] = useState(null);
  const [error, setError] = useState(null);
  const [loaded, setLoaded] = useState([]);
  const [kinds, setKinds] = useState(() => new Set(KINDS));
  const [rule, setRule] = useState("");
  const [strikesOnly, setStrikesOnly] = useState(false);
  const [open, setOpen] = useState(() => new Set());
  const [limit, setLimit] = useState(PAGE);

  const timeline = useMemo(() => {
    try {
      return { entries: buildTimeline({ log, appLog }), error: null };
    } catch (err) {
      return { entries: [], error: err.message };
    }
  }, [log, appLog]);
  const shown = useMemo(
    () => filterTimeline(timeline.entries, { kinds, rule, strikesOnly }),
    [timeline.entries, kinds, rule, strikesOnly],
  );
  const firstAt = timeline.entries.find((e) => e.at !== null)?.at ?? null;
  const counts = useMemo(() => {
    const byKind = {};
    for (const entry of timeline.entries) byKind[entry.kind] = (byKind[entry.kind] ?? 0) + 1;
    return byKind;
  }, [timeline.entries]);

  const load = async (files) => {
    const read = await readFiles(files);
    if (read.log) setLog(read.log);
    if (read.appLog) setAppLog(read.appLog);
    setLoaded((names) => [...names, ...read.names]);
    setOpen(new Set());
    setError(null);
  };

  const paste = (text, target) => {
    if (!text.trim()) return;
    if (target === "app") {
      setAppLog(text);
      return;
    }
    try {
      setLog(JSON.parse(text));
      setError(null);
    } catch (err) {
      setError(`Not JSON: ${err.message}`);
    }
  };

  const toggle = (set, value) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };

  return (
    <div
      style={page}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        load([...e.dataTransfer.files]);
      }}
    >
      <h1 style={{ fontSize: 18, margin: "0 0 8px" }}>Proctoring timeline</h1>
      <p style={{ margin: "0 0 12px", color: "#475569" }}>
        Drop the proctoring log JSON (and optionally the desktop app log) anywhere on the page, or
        paste below. Dev only.
      </p>

      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr", marginBottom: 12 }}>
        <textarea
          style={textarea}
          placeholder="Paste proctoring log JSON"
          aria-label="Proctoring log JSON"
          onBlur={(e) => paste(e.target.value, "log")}
        />
        <textarea
          style={textarea}
          placeholder="Paste app log text (optional)"
          aria-label="App log text"
          onBlur={(e) => paste(e.target.value, "app")}
        />
      </div>

      <div style={panel}>
        <input type="file" multiple onChange={(e) => load([...e.target.files])} />
        {loaded.length > 0 && <span style={{ color: "#475569" }}>{loaded.join(", ")}</span>}
        <button
          type="button"
          onClick={() => {
            setLog(null);
            setAppLog(null);
            setLoaded([]);
          }}
        >
          clear
        </button>
      </div>

      {(error || timeline.error) && (
        <p style={{ color: "#dc2626" }} role="alert">
          {error || timeline.error}
        </p>
      )}

      <div style={panel}>
        {KINDS.map((kind) => (
          <label key={kind} style={{ color: COLORS[kind] }}>
            <input
              type="checkbox"
              checked={kinds.has(kind)}
              onChange={() => setKinds((set) => toggle(set, kind))}
            />{" "}
            {kind} ({counts[kind] ?? 0})
          </label>
        ))}
        <label>
          <input
            type="checkbox"
            checked={strikesOnly}
            onChange={(e) => setStrikesOnly(e.target.checked)}
          />{" "}
          strikes only
        </label>
        <input
          placeholder="rule / type filter, e.g. LOOKING_AWAY or tv"
          value={rule}
          onChange={(e) => setRule(e.target.value)}
          style={{ font: "inherit", minWidth: 280, padding: 3 }}
        />
        <span style={{ color: "#475569" }}>
          {shown.length} of {timeline.entries.length}
        </span>
      </div>

      <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {shown.slice(0, limit).map((entry) => (
          <li
            key={entry.id}
            style={{
              borderLeft: `4px solid ${COLORS[entry.kind]}`,
              background: entry.strike ? "#fee2e2" : entry.kind === "end" ? "#e2e8f0" : "#fff",
              padding: "3px 8px",
              marginBottom: 2,
              cursor: "pointer",
            }}
            onClick={() => setOpen((set) => toggle(set, entry.id))}
          >
            <span style={{ color: "#64748b" }}>{formatTime(entry.at, firstAt)}</span>{" "}
            <strong style={{ color: COLORS[entry.kind] }}>{entry.title}</strong>{" "}
            <span style={{ whiteSpace: "pre-wrap" }}>{entry.summary}</span>
            {open.has(entry.id) && (
              <pre
                style={{ margin: "6px 0", padding: 8, background: "#f1f5f9", overflow: "auto" }}
                onClick={(e) => e.stopPropagation()}
              >
                {typeof entry.raw === "string" ? entry.raw : JSON.stringify(entry.raw, null, 2)}
              </pre>
            )}
          </li>
        ))}
      </ol>
      {shown.length > limit && (
        <button type="button" onClick={() => setLimit((n) => n + PAGE)}>
          show {Math.min(PAGE, shown.length - limit)} more
        </button>
      )}
    </div>
  );
}
