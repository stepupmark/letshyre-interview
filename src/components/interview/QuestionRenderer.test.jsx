import { render, screen } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import QuestionRenderer from "./QuestionRenderer";
import questionsEn from "@/i18n/locales/en/questions.json";

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    resources: { en: { questions: questionsEn } },
    ns: ["questions"],
    defaultNS: "questions",
    interpolation: { escapeValue: false },
  });
  // Warm the lazy chunk so the test checks routing, not how fast a cold import is.
  await import("./questions/CodeQuestion");
}, 30_000);

const renderQuestion = (type) =>
  render(
    <QuestionRenderer
      question={{ type, text: "Reverse a string." }}
      onSubmit={vi.fn()}
      questionNumber={1}
      endTime={Date.now() + 60_000}
      submitting={false}
      isLastQuestion={false}
    />,
  );

describe("QuestionRenderer", () => {
  it.each(["CODE", "CODING"])("opens the code editor for %s questions", async (type) => {
    renderQuestion(type);

    const editor = await screen.findByRole("textbox");
    expect(editor.className).toContain("font-mono");
  });
});
