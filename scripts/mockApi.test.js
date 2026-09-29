import { START_TIMEOUT_MS } from "../src/config/interview.js";
import { classifyStartFailure, START_FAILURE } from "../src/lib/startFailure.js";
import { classifyVerification } from "../src/hooks/proctoring/useFaceMatchMonitoring.js";
import { detectViolations } from "../src/hooks/proctoring/useProctoringSystem.js";
import {
  AI_PREFIX,
  API_PREFIX,
  createMockState,
  mockResponse,
  scenarioOf,
  SLOW_START_MS,
} from "./mockApi.js";

const post = (url, scenario, state = createMockState()) =>
  mockResponse({ method: "POST", url, scenario, state });
const START = `${API_PREFIX}/user/v1/candidate/interview/ai/start/`;
const ANSWER = `${API_PREFIX}/user/v1/candidate/interview/ai/answer/`;
const AUTO = `${API_PREFIX}/user/v1/candidate/interview/ai/auto_submit/force/`;
const DETECT = `${AI_PREFIX}/api/v1/detect`;
const VERIFY = `${AI_PREFIX}/continuous-verify/verification/continuous-verify`;

// What an axios error from this response looks like to the site.
const asError = ({ status, body }) => ({ response: { status, data: body } });

describe("mock api", () => {
  it("walks the normal path from the first question to a scorecard", () => {
    const state = createMockState();
    const start = post(START, "normal", state);
    expect(start.status).toBe(200);
    expect(start.body.data).toMatchObject({ ai: { current_index: 1, total_questions: 4 } });
    expect(start.body.data.ai.question.question).toBeTruthy();

    const answers = [];
    for (let i = 0; i < 4; i += 1) answers.push(post(ANSWER, "normal", state).body.data.ai);
    expect(answers.slice(0, 3).map((a) => a.current_index)).toEqual([2, 3, 4]);
    expect(answers[2].next_question.type).toBe("PSEUDOCODE_MCQ");
    expect(answers[3].completed).toBe(true);
    expect(answers[3].scorecard.question_breakdown).toHaveLength(4);
  });

  it("fails the start the ways the site tells apart", () => {
    const exhausted = post(START, "attempts-exhausted");
    expect(exhausted.status).toBe(400);
    expect(exhausted.body).toEqual({
      success: false,
      message: "Maximum 3 attempts completed. You cannot take more interviews.",
    });
    expect(classifyStartFailure(asError(exhausted)).kind).toBe(START_FAILURE.EXHAUSTED);
    expect(classifyStartFailure(asError(post(START, "start-500"))).kind).toBe(START_FAILURE.SERVER);
    expect(post(START, "slow-start").delayMs).toBeGreaterThan(START_TIMEOUT_MS);
    expect(SLOW_START_MS).toBeGreaterThan(START_TIMEOUT_MS);
  });

  it("answers detection with a clean frame, or fails it", () => {
    const clean = post(DETECT, "normal").body;
    expect(detectViolations(clean)).toEqual([]);
    expect(post(DETECT, "detect-failing").status).toBe(503);
  });

  it("keeps reporting a face mismatch in face-mismatch-run", () => {
    const state = createMockState();
    const first = post(VERIFY, "face-mismatch-run", state).body;
    const second = post(VERIFY, "face-mismatch-run", state).body;
    expect(classifyVerification(first)).toMatchObject({ verdict: "mismatch", serverTotal: 1 });
    expect(classifyVerification(second)).toMatchObject({ verdict: "mismatch", serverTotal: 2 });
    expect(classifyVerification(post(VERIFY, "normal").body).verdict).toBe("match");
  });

  it("fails answers and the auto-submit in submit-failing", () => {
    expect(post(ANSWER, "submit-failing").status).toBe(500);
    expect(post(AUTO, "submit-failing").status).toBe(500);
    expect(post(AUTO, "normal").body.data.ai.scorecard).toBeTruthy();
  });

  it("picks the scenario from the query, then the cookie, else normal", () => {
    const req = (url, cookie) => ({ url, headers: cookie ? { cookie } : {} });
    expect(scenarioOf(req("/x?scenario=start-500", "mock_scenario=slow-start"))).toBe("start-500");
    expect(scenarioOf(req("/x", "a=1; mock_scenario=slow-start"))).toBe("slow-start");
    expect(scenarioOf(req("/x", "mock_scenario=nope"))).toBe("normal");
    expect(scenarioOf(req("/x"))).toBe("normal");
  });
});
