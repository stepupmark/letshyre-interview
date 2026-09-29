# Deployment

Firebase Hosting, project `interview-letshyre-uat` (`.firebaserc`), via GitHub Actions.

| Workflow                                        | Trigger                            | Runs                                         |
| ----------------------------------------------- | ---------------------------------- | -------------------------------------------- |
| [`ci.yml`](../.github/workflows/ci.yml)         | every PR, push to `main`/`staging` | install, lint, format check, test, build     |
| [`deploy.yml`](../.github/workflows/deploy.yml) | push to `main`, or manual dispatch | install, lint, test, build, deploy to `live` |

Deploys run under the `production` GitHub Environment, restricted to `main`. Build-time config comes from **environment variables** (`vars.*`) for the `VITE_*` values; the only **secret** is `FIREBASE_SERVICE_ACCOUNT`, scoped to `roles/firebasehosting.admin`.

`VITE_*` values are inlined at build time, so changing one requires a redeploy, not a restart. Each one must be listed under the build step's `env:` in `deploy.yml` as well as set as a variable; a variable that isn't listed there never reaches the build.

> `VITE_MIN_DESKTOP_VERSION` is not listed in `deploy.yml` yet, so the desktop version gate is off in production whatever the variable says. Add it to the `env:` block when the gate is first needed.

## Caching

`firebase.json` rewrites every path to `index.html` (SPA routing), serves `index.html` with `no-cache`, and hashed assets and `/mediapipe/**` as immutable for a year. A changed MediaPipe model must ship under a new file name.

## Rolling back

`firebase hosting:rollback`, or re-run `deploy.yml` on an older commit.

## Before relying on a new desktop app API

Deploy the site change only after the desktop app version that provides it is released, and raise `VITE_MIN_DESKTOP_VERSION` to that version when the site can't work without it. See [../CONTRIBUTING.md](../CONTRIBUTING.md).
