// A stand-in for the main API and the AI detection service, served by the Vite
// dev server under /__mock. `pnpm dev:mock` points the site at it.
// Pick a scenario with ?scenario=<name> on the page URL (it is kept in a cookie).

export const API_PREFIX = "/__mock/api";
export const AI_PREFIX = "/__mock/ai";

export const SCENARIOS = [
  "normal",
  "attempts-exhausted",
  "start-500",
  "slow-start",
  "detect-failing",
  "face-mismatch-run",
  "submit-failing",
];

// START_TIMEOUT_MS in src/config/interview.js is 60s; answer after it has given up.
export const SLOW_START_MS = 65_000;

const QUESTIONS = [
  { id: "q1", type: "TYPING", question: "Tell us about a project you are proud of." },
  {
    id: "q2",
    type: "MCQ",
    question: "What does `const` prevent in JavaScript?",
    options: [
      "A. Mutating the object it holds",
      "B. Reassigning the binding",
      "C. Hoisting",
      "D. Garbage collection",
    ],
  },
  {
    id: "q3",
    type: "CODING",
    question: "Write a function `reverse(s)` that returns the string reversed.",
  },
  {
    id: "q4",
    type: "PSEUDOCODE_MCQ",
    question: "What does this return when the cache is fresh?",
    code_snippet: "if cache.valid():\n  return cache.data\nreturn fetch()",
    options: ["A. Always fetched data", "B. The cached data", "C. Nothing", "D. An error"],
  },
];

function scorecard() {
  return {
    overall_score: 72.5,
    comm_metrics: {
      clarity: 80,
      confidence: 70,
      relevance: 75,
      depth_of_thought: 65,
      key_concept_coverage: 70,
    },
    strengths: ["Clear structure", "Good examples"],
    areas_for_improvement: ["Go deeper on trade-offs"],
    recommendations: ["Practise explaining complexity"],
    question_breakdown: QUESTIONS.map((q, i) => ({
      question_number: i + 1,
      type: q.type,
      question_text: q.question,
      ...(q.code_snippet ? { code_snippet: q.code_snippet } : {}),
      answer_provided: q.options ? q.options[1] : "mock answer",
      ...(q.options ? { correct_answer: q.options[1] } : {}),
      is_correct: i % 2 === 1,
    })),
  };
}

const ok = (body, extra = {}) => ({ status: 200, body, ...extra });
const fail = (status, message) => ({ status, body: { success: false, message } });

export function createMockState() {
  return { index: 0, mismatches: 0, sessions: 0 };
}

/**
 * The response for one request. Pure, so it can be tested without a server.
 * @returns {{ status: number, body: unknown, delayMs?: number }}
 */
export function mockResponse({ method, url, scenario = "normal", state }) {
  const path = url.split("?")[0];
  if (method !== "POST") return fail(405, `mock api: ${method} not handled`);

  if (path.startsWith(API_PREFIX)) {
    const route = path.slice(API_PREFIX.length);
    switch (route) {
      case "/user/v1/candidate/interview/ai/start/": {
        if (scenario === "attempts-exhausted") {
          return fail(400, "Maximum 3 attempts completed. You cannot take more interviews.");
        }
        if (scenario === "start-500") return fail(500, "Internal server error");
        state.index = 0;
        state.mismatches = 0;
        state.sessions += 1;
        const response = ok({
          success: true,
          data: {
            interview_id: `mock-interview-${state.sessions}`,
            session_id: `mock-session-${Date.now()}`,
            proctoring_token: "mock-proctoring-token",
            ai: { question: QUESTIONS[0], current_index: 1, total_questions: QUESTIONS.length },
          },
        });
        return scenario === "slow-start" ? { ...response, delayMs: SLOW_START_MS } : response;
      }
      case "/user/v1/candidate/interview/ai/answer/": {
        if (scenario === "submit-failing") return fail(500, "Could not save the answer");
        state.index += 1;
        if (state.index >= QUESTIONS.length) {
          return ok({ success: true, data: { ai: { completed: true, scorecard: scorecard() } } });
        }
        return ok({
          success: true,
          data: {
            ai: {
              current_index: state.index + 1,
              total_questions: QUESTIONS.length,
              next_question: QUESTIONS[state.index],
            },
          },
        });
      }
      case "/user/v1/candidate/interview/ai/auto_submit/force/":
        if (scenario === "submit-failing") return fail(500, "Could not submit the interview");
        return ok({ success: true, data: { ai: { completed: true, scorecard: scorecard() } } });
      case "/user/v1/candidate/interview/voice_enroll/":
        return ok({ success: true, data: { enrollment_id: "mock-enrollment" } });
      case "/user/v1/candidate/interview/voice_compare/":
        return ok({ success: true, data: { matched: true, score: 0.88 } });
      case "/user/v1/candidate/interview/proctoring/log/":
        return ok({ success: true, message: "logged" });
      case "/user/v1/login_refresh/":
        return ok({ access_token: "mock-access", refresh_token: "mock-refresh" });
      default:
        return fail(404, `mock api: no route for ${route}`);
    }
  }

  if (path.startsWith(AI_PREFIX)) {
    const route = path.slice(AI_PREFIX.length);
    switch (route) {
      case "/api/v1/detect":
        if (scenario === "detect-failing") return fail(503, "detector unavailable");
        return ok({
          success: true,
          face_detected: true,
          face_count: 1,
          confidence_score: 0.95,
          looking_at_camera: true,
          eyes_open: true,
          frame_quality: "good",
          objects_detected: [],
          violations: [],
        });
      case "/continuous-verify/verification/register-face":
        return ok({ success: true, message: "Face registered" });
      case "/continuous-verify/verification/continuous-verify":
        if (scenario === "face-mismatch-run") {
          state.mismatches += 1;
          return ok({
            success: false,
            same_person: false,
            violation: "FACE_MISMATCH",
            confidence: 0.05,
            total_violations: state.mismatches,
          });
        }
        return ok({ success: true, same_person: true, confidence: 0.91 });
      default:
        return fail(404, `mock ai: no route for ${route}`);
    }
  }

  return null;
}

export function scenarioOf(req) {
  const query = new URL(req.url, "http://mock").searchParams.get("scenario");
  const cookie = req.headers.cookie?.match(/(?:^|;\s*)mock_scenario=([^;]*)/)?.[1];
  const scenario = query ?? (cookie ? decodeURIComponent(cookie) : "normal");
  return SCENARIOS.includes(scenario) ? scenario : "normal";
}

export function mockApiPlugin() {
  const states = new Map();
  return {
    name: "letshyre-mock-api",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url.startsWith(API_PREFIX) && !req.url.startsWith(AI_PREFIX)) return next();
        // Drain the body; nothing here depends on what was sent.
        req.on("data", () => {});
        req.on("end", () => {
          const scenario = scenarioOf(req);
          if (!states.has(scenario)) states.set(scenario, createMockState());
          const result = mockResponse({
            method: req.method,
            url: req.url,
            scenario,
            state: states.get(scenario),
          });
          const send = () => {
            if (res.writableEnded || req.destroyed) return;
            res.statusCode = result.status;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(result.body));
            server.config.logger.info(
              `[mock ${scenario}] ${req.method} ${req.url} → ${result.status}`,
              { timestamp: true },
            );
          };
          if (result.delayMs) setTimeout(send, result.delayMs);
          else send();
        });
      });
    },
  };
}
