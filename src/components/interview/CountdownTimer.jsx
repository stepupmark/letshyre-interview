import { useEffect, useState } from "react";

function format(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = String(Math.floor(total / 60)).padStart(2, "0");
  const s = String(total % 60).padStart(2, "0");
  return `${m}:${s}`;
}

/**
 * Self-contained countdown display. Ticks on its own internal state from an
 * absolute `endTime`, so the 1s re-render stays local to this component instead
 * of re-rendering the whole interview/question subtree every second.
 */
export default function CountdownTimer({ endTime }) {
  const [label, setLabel] = useState(() => format(endTime ? endTime - Date.now() : 0));

  useEffect(() => {
    if (!endTime) return;
    // Deferred (not a direct synchronous setState-in-effect) so it satisfies
    // react-hooks/set-state-in-effect while still resyncing immediately if
    // `endTime` changes after mount.
    queueMicrotask(() => setLabel(format(endTime - Date.now())));
    const id = setInterval(() => {
      const remaining = endTime - Date.now();
      setLabel(format(remaining));
      if (remaining <= 0) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [endTime]);

  return <>{label}</>;
}
