import { render, screen, within } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import ScoreCard from "./ScoreCard";
import interviewEn from "@/i18n/locales/en/interview.json";

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    resources: { en: { interview: interviewEn } },
    ns: ["interview"],
    defaultNS: "interview",
    interpolation: { escapeValue: false },
  });
});

vi.mock("@/lib/electronRecording", () => ({ stopProctoringOnce: vi.fn() }));

// Shapes copied from real scorecard responses.
const breakdown = [
  {
    question_number: 1,
    type: "AUDIO",
    question_text: "Voice question 1",
    answer_provided: "",
    audio_file_provided: true,
    audio_data: "audio_answer.webm",
    transcript: "MBC 뉴스 이덕영입니다.",
    is_correct: false,
  },
  {
    question_number: 2,
    type: "TYPING",
    question_text: "Typed question 2",
    answer_provided: "line one\nline two",
    is_correct: false,
  },
  {
    question_number: 3,
    type: "PSEUDOCODE_MCQ",
    question_text: "Pseudocode question 3",
    answer_provided: "A. Returns the fetched data every time",
    correct_answer: "B. Returns cached data if valid, else fetches new data",
    is_correct: false,
  },
  {
    question_number: 4,
    type: "MCQ",
    question_text: "Choice question 4",
    answer_provided: "B. It prevents reassignment.",
    correct_answer: "B. It prevents reassignment.",
    is_correct: true,
  },
  {
    question_number: 5,
    type: "CODING",
    question_text: "Coding question 5",
    answer_provided: "var a = 10",
    is_correct: false,
  },
  {
    question_number: 6,
    type: "TYPING",
    question_text: "Typed question 6",
    answer_provided: "   ",
    is_correct: false,
  },
  {
    question_number: 7,
    type: "AUDIO",
    question_text: "Voice question 7",
    answer_provided: "",
    audio_file_provided: false,
    audio_data: null,
    transcript: null,
    is_correct: false,
  },
];

const renderCard = (props = {}) =>
  render(
    <ScoreCard
      scorecard={{
        overall_score: 21.5,
        comm_metrics: {},
        strengths: [],
        areas_for_improvement: [],
        recommendations: [],
        question_breakdown: breakdown,
      }}
      {...props}
    />,
  );

const card = (text) => within(screen.getByText(text).closest(".rounded-2xl"));

describe("ScoreCard question breakdown", () => {
  it("shows every question in the response, in order", () => {
    renderCard();

    const shown = screen.getAllByText(/question \d$/i).map((node) => node.textContent);
    expect(shown).toEqual(breakdown.map((q) => q.question_text));
  });

  it("shows only correct or incorrect for voice questions", () => {
    renderCard();

    for (const text of ["Voice question 1", "Voice question 7"]) {
      const voice = card(text);
      expect(voice.getByText("Incorrect")).toBeInTheDocument();
      expect(voice.queryByText("Your Answer")).not.toBeInTheDocument();
      expect(voice.queryByText("Not answered")).not.toBeInTheDocument();
    }
    expect(screen.queryByText(/MBC/)).not.toBeInTheDocument();
    expect(screen.queryByText(/audio_answer/)).not.toBeInTheDocument();
  });

  it("shows a typed answer as it was entered", () => {
    renderCard();

    expect(card("Typed question 2").getByText(/line one\s+line two/)).toBeInTheDocument();
  });

  it("shows the picked and the correct answer for choice questions", () => {
    renderCard();

    const wrong = card("Pseudocode question 3");
    expect(wrong.getByText(/A\. Returns the fetched data every time/)).toBeInTheDocument();
    expect(wrong.getByText("Correct answer")).toBeInTheDocument();
    expect(
      wrong.getByText("B. Returns cached data if valid, else fetches new data"),
    ).toBeInTheDocument();
    expect(wrong.getByText("✗")).toBeInTheDocument();

    const right = card("Choice question 4");
    expect(right.getByText("Correct")).toBeInTheDocument();
    expect(right.getByText("✓")).toBeInTheDocument();
  });

  it("shows a coding answer in a code block", () => {
    renderCard();

    const code = card("Coding question 5").getByText("var a = 10");
    expect(code.closest("pre")).not.toBeNull();
  });

  it("marks a blank typed answer as not answered", () => {
    renderCard();

    const blank = card("Typed question 6");
    expect(blank.getByText("Not answered")).toBeInTheDocument();
    expect(blank.getByText("No answer provided")).toBeInTheDocument();
  });

  it("counts the answered questions", () => {
    renderCard();

    expect(screen.getByText("5 of 7 answered")).toBeInTheDocument();
  });
});

describe("ScoreCard overall score", () => {
  it("shows a whole-number percentage", async () => {
    render(
      <ScoreCard
        scorecard={{ overall_score: 17.7, comm_metrics: { clarity: 33.3 }, question_breakdown: [] }}
      />,
    );

    expect(await screen.findByText("18")).toBeInTheDocument();
    expect(screen.queryByText("17.7")).not.toBeInTheDocument();
    expect(await screen.findByText("33%")).toBeInTheDocument();
  });
});

describe("ScoreCard ending", () => {
  it.each([
    ["completed", "Interview complete"],
    ["expired", "Time's up"],
    ["terminated", "Interview ended early"],
    ["auto-submitted", "Interview submitted"],
  ])("titles a %s interview %j", (endReason, title) => {
    renderCard({ endReason });

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(title);
  });

  it("treats a missing reason as a normal finish", () => {
    renderCard();

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Interview complete");
  });
});
