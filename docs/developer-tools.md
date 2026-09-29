# Developer tools

Everything below is dev only: it lives in `src/dev/` and `scripts/`, is loaded from
`main.jsx` behind `import.meta.env.DEV`, and is left out of `pnpm build`.

**Fake desktop app** — `pnpm dev`, then open `/?desktop=fake` (it stays on for the tab;
`?desktop=off` turns it off). It installs a stand-in `window.electronAPI` and a panel in
the corner to:

- send any violation code as a soft or hard block, or re-send the last one (same id,
  `redelivered: true`), with the payload the app sends;
- play an older app: without `abortInterview`, or with another version (or none) in the
  user agent. The update screen needs `VITE_MIN_DESKTOP_VERSION` set;
- raise a screen-recording error;
- see every call the site made (`startProctoring`, `acknowledgeViolation`,
  `interviewComplete`…).

**Mock backend** — `pnpm dev:mock` serves the main API and the AI service from the dev
server (`scripts/mockApi.js`), so no `.env` or backend is needed; tokens and a reference
photo are filled in. Pick a scenario with `?scenario=`:

| Scenario             | What happens                                           |
| -------------------- | ------------------------------------------------------ |
| `normal` (default)   | Four questions, clean frames, matching face, scorecard |
| `attempts-exhausted` | Start answers 400 "Maximum 3 attempts completed…"      |
| `start-500`          | Start answers 500                                      |
| `slow-start`         | Start answers after 65s, past `START_TIMEOUT_MS`       |
| `detect-failing`     | `/detect` answers 503 (degraded mode)                  |
| `face-mismatch-run`  | Every identity check is a mismatch                     |
| `submit-failing`     | Answers and the auto-submit answer 500                 |

Combine them: `/?scenario=face-mismatch-run&desktop=fake`.

**Timeline viewer** — `/__dev/timeline` in `pnpm dev`. Drop (or paste) the proctoring log
JSON the site submits, and optionally the desktop app's `secure-interview.log`, to see
frames, decisions, strikes, desktop violations, window events, disconnects and the ending in
one timeline. Filter by type or rule; click a row for the raw record.

**Shadow report** — what shadowed rules and labels would have done if enforced:

```bash
pnpm shadow:report logs/*.json            # --max 3 --cooldown 30 --json
```

For each rule (`gaze`, `verify_faces`, `label:tv`…) it prints the sessions affected, the
would-be strikes (one per 30s per rule), how many sessions they would have ended against
`MAX_VIOLATIONS`, and a few example timestamps.
