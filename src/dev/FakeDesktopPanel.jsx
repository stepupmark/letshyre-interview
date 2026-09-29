import { useEffect, useState } from "react";
import { saveDesktopSettings, VIOLATION_CODES } from "./fakeDesktop";

// Inline styles: Tailwind would scan this file and ship its classes in the production CSS.
const box = {
  position: "fixed",
  right: 12,
  bottom: 12,
  zIndex: 2147483647,
  width: 340,
  maxHeight: "70vh",
  display: "flex",
  flexDirection: "column",
  gap: 8,
  padding: 10,
  font: "12px/1.4 ui-monospace, Menlo, Consolas, monospace",
  color: "#e2e8f0",
  background: "rgba(15, 23, 42, 0.95)",
  border: "1px solid #334155",
  borderRadius: 8,
  boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
  pointerEvents: "auto",
};
const row = { display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" };
const button = {
  font: "inherit",
  padding: "3px 8px",
  color: "#0f172a",
  background: "#e2e8f0",
  border: 0,
  borderRadius: 4,
  cursor: "pointer",
};
const input = { font: "inherit", color: "#0f172a", background: "#f8fafc", borderRadius: 4 };

const VERSIONS = ["1.5.0", "1.4.5", "1.4.0", "1.0.0", ""];

function summarize(args) {
  return args
    .map((arg) => {
      if (arg && typeof arg === "object" && "code" in arg) {
        const hard = arg.isHardBlock ? "hard" : "soft";
        return `${arg.code} ${hard}${arg.redelivered ? " redelivered" : ""} #${arg.count}`;
      }
      return JSON.stringify(arg);
    })
    .join(" ");
}

export default function FakeDesktopPanel({ controls, settings }) {
  const [open, setOpen] = useState(true);
  const [code, setCode] = useState(VIOLATION_CODES[0]);
  const [calls, setCalls] = useState(() => controls.calls);
  const [abort, setAbort] = useState(settings.abortInterview);
  const [version, setVersion] = useState(settings.version);

  useEffect(() => controls.subscribe(() => setCalls(controls.calls)), [controls]);

  const changed = abort !== settings.abortInterview || version !== settings.version;
  const apply = () => {
    saveDesktopSettings({ abortInterview: abort, version });
    window.location.reload();
  };

  if (!open) {
    return (
      <button type="button" style={{ ...box, width: "auto" }} onClick={() => setOpen(true)}>
        fake desktop ({calls.length})
      </button>
    );
  }

  return (
    <div style={box} data-testid="fake-desktop-panel">
      <div style={{ ...row, justifyContent: "space-between" }}>
        <strong>Fake desktop</strong>
        <span style={{ color: controls.listening ? "#86efac" : "#fca5a5" }}>
          {controls.listening ? "site listening" : "no listener"}
        </span>
        <button type="button" style={button} onClick={() => setOpen(false)}>
          hide
        </button>
      </div>

      <div style={row}>
        <select style={input} value={code} onChange={(e) => setCode(e.target.value)}>
          {VIOLATION_CODES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <button type="button" style={button} onClick={() => controls.fire(code)}>
          soft
        </button>
        <button type="button" style={button} onClick={() => controls.fire(code, { hard: true })}>
          hard
        </button>
        <button type="button" style={button} onClick={() => controls.redeliverLast()}>
          redeliver last
        </button>
      </div>

      <div style={row}>
        <button type="button" style={button} onClick={() => controls.proctoringError()}>
          proctoring error
        </button>
      </div>

      <div style={row}>
        <label>
          <input type="checkbox" checked={abort} onChange={(e) => setAbort(e.target.checked)} />{" "}
          abortInterview
        </label>
        <label>
          version{" "}
          <select style={input} value={version} onChange={(e) => setVersion(e.target.value)}>
            {VERSIONS.map((v) => (
              <option key={v} value={v}>
                {v || "no token"}
              </option>
            ))}
          </select>
        </label>
        {changed && (
          <button type="button" style={button} onClick={apply}>
            apply + reload
          </button>
        )}
      </div>
      <div style={{ color: "#94a3b8" }}>
        min version: {import.meta.env.VITE_MIN_DESKTOP_VERSION || "unset (every build allowed)"}
      </div>

      <div
        style={{ overflow: "auto", borderTop: "1px solid #334155", paddingTop: 6 }}
        aria-label="Calls from the site"
      >
        {calls.length === 0 && <div style={{ color: "#94a3b8" }}>no calls yet</div>}
        {[...calls].reverse().map((call, i) => (
          <div key={calls.length - i} title={JSON.stringify(call.args)}>
            <span style={{ color: "#94a3b8" }}>{call.at.slice(11, 19)}</span>{" "}
            <span style={{ color: call.name.startsWith("→") ? "#fcd34d" : "#93c5fd" }}>
              {call.name}
            </span>{" "}
            {summarize(call.args)}
          </div>
        ))}
      </div>
    </div>
  );
}
