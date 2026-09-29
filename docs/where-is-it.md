# Where is it

To change X, open Y. Paths are under `src/` unless they start with a dot or a repo-root folder.

## Limits and tunables

| To change                                                    | Open                                                                                               |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Strike limit, identity limits, disconnect limit, re-strike   | `config/interview.js` (values come from `VITE_*`, see [architecture](architecture.md#environment)) |
| Interview length                                             | `VITE_AI_INTERVIEW_DURATION_MINUTES` → `config/interview.js`                                       |
| Which objects count, confidence floor, shadowed labels/rules | `config/interview.js`, rules in `hooks/proctoring/useProctoringSystem.js`                          |
| Cooldowns and the reaction window                            | `lib/strikePolicy.js`                                                                              |
| How many frames confirm a violation                          | `lib/violationStabilizer.js`                                                                       |
| When an incident starts and ends                             | `lib/incidentTracker.js`                                                                           |
| Room baseline (TV, books)                                    | `lib/baselineTracker.js`                                                                           |

## Detection

| To change                                 | Open                                                                                                                        |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| The camera loop, triggers, backoff        | `hooks/proctoring/useProctoringSystem.js`                                                                                   |
| Identity checks and their limits          | `hooks/proctoring/useFaceMatchMonitoring.js`                                                                                |
| Tab, focus, fullscreen and resize strikes | `hooks/proctoring/useViolationMonitor.js`                                                                                   |
| On-device face and phone watches          | `hooks/proctoring/useLocalFaceWatch.js`, `useLocalObjectWatch.js`, `lib/localFaceDetector.js`, `lib/localObjectDetector.js` |
| Camera off / virtual camera logging       | `useProctoringSystem.js` (`checkCamera`), `hooks/proctoring/useCameraIntegrity.js`                                          |
| AI service calls                          | `services/proctoring.api.js`, `services/face.api.js`, `services/clients/aiDetection.js`                                     |

## Desktop app

| To change                                         | Open                                                                       |
| ------------------------------------------------- | -------------------------------------------------------------------------- |
| How a desktop violation code is shown and counted | `lib/electronViolations.js` (`KEY_BY_CODE`, `BY_KEY`)                      |
| Receiving and acknowledging desktop violations    | `hooks/electron/useElectronViolation.js`                                   |
| Telling the app the interview ended               | `hooks/electron/useInterviewComplete.js`                                   |
| Leaving to the dashboard after a failed start     | `lib/desktopExit.js`, `components/interview/BackToDashboardButton.jsx`     |
| Screen recording start/stop and its health        | `hooks/electron/useElectronScreenRecording.js`, `lib/electronRecording.js` |
| Oldest app allowed                                | `VITE_MIN_DESKTOP_VERSION`, `lib/desktopVersion.js`                        |
| What the app promises the site                    | `contract/interview-contract.json` (a copy; edit it in the app repo)       |

## Session and endings

| To change                                      | Open                                                                                            |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Starting, restoring and the timer              | `hooks/interview/useInterviewSession.js`                                                        |
| Why a start failed and what the candidate sees | `lib/startFailure.js`, `components/interview/InterviewStartFailed.jsx`                          |
| Rules card and camera check before start       | `components/interview/PreStart.jsx`, `hooks/interview/usePreStart.js`, `lib/cameraCheck.js`     |
| Every ending (auto-submit, termination)        | `hooks/interview/useAutoSubmitFlow.js`, reasons in `lib/terminationReasons.js`                  |
| Termination notice and its timing              | `components/interview/TerminationNotice.jsx`, `hooks/interview/useTerminationNotice.js`         |
| Reference code and the help panel              | `lib/referenceCode.js`, `components/interview/GetHelp.jsx`, `hooks/interview/useSupportInfo.js` |
| What gets written to the proctoring log        | `lib/violationLog.js`, batch sending in `useProctoringSystem.js`                                |

## Add a violation code end to end

1. The app repo: add it to `src/shared/violationCodes.js` and `contract/interview-contract.json`, then run `pnpm contract:sync <this checkout>`.
2. Here: map it in `KEY_BY_CODE` and give it an entry in `BY_KEY` (`lib/electronViolations.js`). `contract/interviewContract.test.js` fails until you do.
3. Add `violations.electron.<key>.title`, `.description` and `.fix` to `i18n/locales/en/interview.json` and the other 18 locales.

## Everything else

| To change                                           | Open                                                            |
| --------------------------------------------------- | --------------------------------------------------------------- |
| A string                                            | `i18n/locales/<lang>/<namespace>.json`; see [i18n](i18n.md)     |
| A route                                             | `router/routeConfig.jsx`                                        |
| Token handling and 401 refresh                      | `services/clients/backend.js`, `router/privateLoader.js`        |
| Question types                                      | `components/interview/questions/`                               |
| Deploy and build-time values                        | `.github/workflows/deploy.yml`; see [deployment](deployment.md) |
| Fake desktop app, mock API, timeline, shadow report | `dev/`, `scripts/`; see [developer tools](developer-tools.md)     |
