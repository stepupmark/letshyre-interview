# LetsHyre — Secure AI Interview

The interview site candidates take their LetsHyre interview on. It runs in a browser or inside the LetsHyre desktop app, which locks the screen around it. Candidates arrive through a tokenized link and take a timed, multi-format interview while the camera, the window and the desktop app are watched. A strike engine warns, and ends the interview when integrity is breached. Available in 19 languages.

React 19 + Vite 8, react-query, i18next, Tailwind 4, Vitest.

## Run

Needs Node 22, pnpm 10, a reachable main API and AI detection service, and a camera.

```bash
pnpm install
cp .env.example .env    # fill in the values; never end a URL with a slash
pnpm dev                # http://localhost:5173
```

Open it through a tokenized link: `http://localhost:5173/?ac=<access_token>&rc=<refresh_token>`. Without valid tokens you land on `/unauthorized-access`.

## Test

```bash
pnpm lint
pnpm test          # Vitest, once; pnpm test:watch to keep it running
pnpm format:check
pnpm build
```

Coverage leans toward what can end someone's interview: the session state machine, every auto-submit trigger, strike counting and suppression, detection confirmation and termination copy. When you move a module, update its `vi.mock(...)` path to match; Vitest matches mocks by exact path.

## Conventions

- Components render; hooks own state and effects; services own the network. Never call axios from a component. Mutations live in `mutations/`.
- Tunables come from `src/config/interview.js`, never a literal: a hardcoded `3` in copy is wrong the day the env value changes.
- Every candidate-facing string is an i18n key.
- Desktop access is always feature-detected (`window.electronAPI?.…`).
- Storage keys are plain strings (`ac`, `rc`, `interview_session`); reuse the exact spelling.
- Log through `lib/logger`, not `console`.

## Deploy

A push to `main` deploys to Firebase Hosting after lint, tests and the build pass. `VITE_*` values are inlined at build time, so changing one needs a redeploy. Details and rollback: [docs/deployment.md](docs/deployment.md).

## Docs

- [Architecture](docs/architecture.md): tech stack, environment, project structure, candidate flow, routing, API surface, the desktop app
- [Proctoring](docs/proctoring.md): the camera loop, confirmation, identity, leaving the interview, desktop violations, strikes, termination, the proctoring log
- [Internationalization](docs/i18n.md)
- [Deployment](docs/deployment.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Where is it](docs/where-is-it.md): to change X, open Y
- Decisions: [the site owns enforcement](docs/decisions/site-owns-enforcement.md) · [a false strike is worse than a missed one](docs/decisions/false-strike-worse-than-miss.md) · [shadow mode before enforcement](docs/decisions/shadow-mode-before-enforcement.md) · [one way to end an interview](docs/decisions/one-way-to-end.md)
- [Contributing](CONTRIBUTING.md)
