# The site owns enforcement

**Decision:** the desktop app detects and reports. This site decides what a violation costs and when the interview ends.

**Why:** strikes, warnings, identity checks and the termination notice all live here, with limits set at build time and copy in 19 languages. Tuning a limit shouldn't need a desktop release, and one enforcement path can't disagree with itself.

**What it means in code:**

- Desktop violations arrive through `useElectronViolation.js`, are acknowledged by `id` first, and are mapped by `code` in `lib/electronViolations.js`.
- The app's `isHardBlock` is advice: the site may treat a code as harder, never softer. Extra displays are strikes, never hard.
- Hard blocks end the interview through the same `autoSubmit` as everything else ([one way to end](one-way-to-end.md)).
- Only this site's `interviewComplete()` releases the app's lockdown.
