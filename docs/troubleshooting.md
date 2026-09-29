# Troubleshooting

| Symptom                                             | Likely cause                                                                                              |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Immediate redirect to `/unauthorized-access`        | Missing/invalid `ac`/`rc` in the URL or `sessionStorage`                                                  |
| Requests 404 or hit a strange host                  | A URL env value has a **trailing slash**                                                                  |
| Interview auto-submits unexpectedly                 | Violation, face-mismatch, or network-drop limit reached; check the reason on the termination notice       |
| A warning with nothing wrong on camera              | Look up its `violation_decision` records in the proctoring log: `seen_by`, `trigger` and scores show why  |
| "Proctoring checks temporarily unavailable"         | Degraded mode: 3+ consecutive detection failures; check the AI service                                    |
| Raw `violations.…` / `termination.…` text on screen | A missing i18n key in `en/interview.json`                                                                 |
| Camera prompts blocked                              | Browser permissions, or plain `http` on a non-localhost origin                                            |
| "Update the app" screen in the desktop app          | The app is older than `VITE_MIN_DESKTOP_VERSION`, or too old to send its version in the user agent        |
| Desktop violation shown with generic copy           | The app sent a code this site doesn't map; `src/contract/interviewContract.test.js` should have caught it |
| Same desktop violation logged as `duplicate`        | Expected: the app re-sends until acknowledged and after every page load; it is handled once by `id`       |
| `pnpm format:check` fails in CI                     | Run `pnpm format` and commit; Prettier covers Markdown and JSON too                                       |

## Manually exercising the anti-cheat flow

1. Start an interview and enter fullscreen.
2. Press `Esc` or `Alt+Tab` → expect a strike modal.
3. Refresh → the timer persists, it does not reset.
4. Try `Ctrl+C`/`Ctrl+V` or right-click → blocked.
5. Reach the strike limit → termination notice, then automatic submission.

In the desktop app, `Esc` and `Alt+Tab` are held by the lockdown, so test leaving the window in a browser.
