# Shadow mode before enforcement

**Decision:** a new rule or label ships logged but not shown or counted, and is enforced only once real interviews show it is right.

**Why:** thresholds picked at a desk are wrong in real rooms. `tv` is shadowed by default because it is the highest false-positive label in the set, and long look-away (`gaze`) because typing looks like looking away.

**What it means in code:**

- `VITE_AI_SHADOW_LABELS` and `VITE_AI_SHADOW_RULES` (`config/interview.js`) keep a label or rule in the log with outcome `shadow`.
- Camera integrity (virtual camera, frozen picture) is log-only (`useCameraIntegrity.js`).
- New desktop codes the site isn't sure about are mapped `logOnly` first (`focusLost`, `virtualDesktop` in `lib/electronViolations.js`).
- `pnpm shadow:report <logs>` shows how many strikes and terminations a shadowed rule would have caused. Promote it when those numbers hold up.
