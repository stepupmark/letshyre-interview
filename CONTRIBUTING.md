# Contributing

## Branches and PRs

- Branch off `main`, keep it short-lived, and name it for the change: `fix/detection-edge-cases`, `feat/interview-start-recovery`.
- Open a PR into `main`. CI runs lint, tests, format check and the build (`.github/workflows/ci.yml`); all must pass.
- A push to `main` deploys to production (`.github/workflows/deploy.yml`), so merge only what is ready to ship.
- One change per PR. A refactor that a fix needs goes in its own commit.

Before pushing:

```bash
pnpm lint
pnpm test
pnpm format:check
pnpm build
```

## Working with the desktop app

`src/contract/interview-contract.json` is a copy of the desktop app's contract: violation codes, the `window.electronAPI` methods, the sessionStorage handoff and the reasons. Don't edit it here.

- **The app changes first.** A new code or method lands in the app repo, then `pnpm contract:sync <this checkout>` there brings the copy over. `src/contract/interviewContract.test.js` fails until every code is mapped.
- **Feature-detect everything.** Candidates run older app builds. Call new methods as `window.electronAPI?.newMethod?.()` and keep a fallback, as `lib/desktopExit.js` does for `abortInterview`.
- **Raise `VITE_MIN_DESKTOP_VERSION`** only when the site can't work without the new app API, and only after that app version is released. See [docs/deployment.md](docs/deployment.md).

## Proctoring changes

A change that can cost a candidate a strike or end an interview needs tests beside the rule, and a note in [docs/proctoring.md](docs/proctoring.md). A new rule or label ships in shadow mode first ([why](docs/decisions/shadow-mode-before-enforcement.md)).

## Commit messages

Conventional commits, as in `git log`:

```
feat(interview): show why an interview could not start instead of loading forever
fix(proctoring): stop a phone behind the face counting as a second person
```

- Types: `feat`, `fix`, `refactor`, `perf`, `style`, `test`, `docs`, `ci`, `chore`.
- Scope is the area: `interview`, `proctoring`, `identity`, `electron`, `i18n`, `ui`, `dev`.
- Subject in the imperative, lower case, no full stop, saying what changes for the candidate or the code.
- Body: a short list of what changed and why, when the subject isn't enough.

## Docs

Update the page in `docs/` that describes what you changed, and [docs/where-is-it.md](docs/where-is-it.md) if you added a new place to look. A decision future changes should respect goes in `docs/decisions/`.
