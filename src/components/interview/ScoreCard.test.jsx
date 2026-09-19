import { render, screen } from "@testing-library/react";
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

describe("ScoreCard", () => {
  it("renders subsequent questions even if an earlier question was skipped or empty", () => {
    const mockScorecard = {
      overall_score: 80,
      comm_metrics: { clarity: 80, confidence: 85, pace: 75 },
      strengths: ["Good articulation"],
      areas_for_improvement: ["More concise code"],
      recommendations: ["Practice dynamic programming"],
      question_breakdown: [
        {
          question_number: 1,
          question_text: "Question 1: Explain React",
          type: "TEXT",
          answer_provided: "React is a UI library",
          score: 9,
          feedback: "Great answer",
        },
        {
          question_number: 2,
          question_text: "Question 2: Skipped Audio",
          type: "AUDIO",
          is_dummy_audio: true,
          answer_provided: "",
          score: 0,
          feedback: "Skipped",
        },
        {
          question_number: 3,
          question_text: "Question 3: Empty Text Answer",
          type: "TEXT",
          answer_provided: "",
          score: 0,
          feedback: "No answer",
        },
        {
          question_number: 4,
          question_text: "Question 4: Architecture Discussion",
          type: "TEXT",
          answer_provided: "Microservices with event sourcing",
          score: 8,
          feedback: "Good",
        },
      ],
    };

    render(<ScoreCard scorecard={mockScorecard} />);

    expect(screen.getByText(/Question 1: Explain React/i)).toBeInTheDocument();
    expect(screen.getByText(/Question 4: Architecture Discussion/i)).toBeInTheDocument();
  });
});
