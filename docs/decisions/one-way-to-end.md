# One way to end an interview

**Decision:** every ending, whatever caused it, goes through one `autoSubmit(reason)`, with the reason a stable code.

**Why:** strikes, identity limits, disconnects, a desktop hard block and the timer can all fire close together. Separate endings submitted twice, showed two notices or told the desktop app twice.

**What it means in code:**

- `useAutoSubmitFlow.js` guards the submission with an in-flight ref and freezes the session straight away, so nothing queued can land after.
- Reasons come from `lib/terminationReasons.js` and drive both the copy and the log; never free text.
- `useInterviewComplete.js` tells the desktop app once, which is what releases its lockdown.
- A start that never produced a session isn't an ending: it goes back through `abortInterview` (`lib/desktopExit.js`), which the app refuses once proctoring has started.
