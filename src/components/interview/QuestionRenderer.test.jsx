import { fireEvent, render, screen, within } from "@testing-library/react";
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
  // Warm the lazy chunks so the tests check behaviour, not how fast a cold import is.
  await Promise.all([
    import("./questions/CodeQuestion"),
    import("./questions/McqQuestion"),
    import("./questions/TypingQuestion"),
  ]);
}, 30_000);

const renderQuestion = (question, { isLastQuestion = false, onSubmit = vi.fn() } = {}) => {
  render(
    <QuestionRenderer
      question={question}
      onSubmit={onSubmit}
      questionNumber={1}
      endTime={Date.now() + 60_000}
      submitting={false}
      isLastQuestion={isLastQuestion}
    />,
  );
  return onSubmit;
};

const typing = { type: "TEXT", text: "Tell me about yourself." };
const mcq = { type: "MCQ", text: "Pick one.", options: ["A. Yes", "B. No"] };
const code = { type: "PSEUDOCODE_MCQ", text: "What prints?", options: ["A. 1", "B. 2"] };

describe("QuestionRenderer", () => {
  it.each(["CODE", "CODING"])("opens the code editor for %s questions", async (type) => {
    renderQuestion({ type, text: "Reverse a string." });

    const editor = await screen.findByRole("textbox");
    expect(editor.className).toContain("font-mono");
  });

  it.each([
    ["multiple choice", mcq, { selected_option: "B. No" }],
    ["pseudocode", code, { selected_option: "B. 2" }],
  ])("submits a %s answer without asking", async (_, question, expected) => {
    const onSubmit = renderQuestion(question);

    fireEvent.click(await screen.findByRole("radio", { name: /B\./ }));
    fireEvent.click(screen.getByRole("button", { name: /next question/i }));

    expect(onSubmit).toHaveBeenCalledWith(expected);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("asks before the last answer ends the interview", async () => {
    const onSubmit = renderQuestion(typing, { isLastQuestion: true });

    fireEvent.change(await screen.findByRole("textbox"), { target: { value: "Hi" } });
    fireEvent.click(screen.getByRole("button", { name: /submit interview/i }));
    expect(onSubmit).not.toHaveBeenCalled();

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Submit your interview?");
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit Interview" }));

    expect(onSubmit).toHaveBeenCalledWith({ answer_text: "Hi" });
  });

  it("keeps the answer when the candidate goes back", async () => {
    const onSubmit = renderQuestion(typing, { isLastQuestion: true });

    const input = await screen.findByRole("textbox");
    fireEvent.change(input, { target: { value: "Hi" } });
    fireEvent.click(screen.getByRole("button", { name: /submit interview/i }));
    fireEvent.click(screen.getByRole("button", { name: "Go back" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(input).toHaveValue("Hi");
  });

  it("tells the candidate answers are final", async () => {
    renderQuestion(typing);

    expect(
      await screen.findByText("Answers can't be changed after you move on."),
    ).toBeInTheDocument();
  });
});
