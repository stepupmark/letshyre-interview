import { useEffect, useState } from "react";

// The current time, refreshed every second while `running`.
export function useNow(running = true) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running) return;
    queueMicrotask(() => setNow(Date.now()));
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);

  return now;
}
