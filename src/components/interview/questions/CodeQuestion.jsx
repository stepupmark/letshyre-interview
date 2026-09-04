import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import QuestionShell from "../QuestionShell";
import CodeBlock from "../CodeBlock";
import { useTranslation } from "react-i18next";

import { toast } from "sonner";

export default function CodeQuestion({
  question,
  onSubmit,
  questionNumber,
  endTime,
  submitting,
  isLastQuestion,
}) {
  const { t } = useTranslation("questions");
  const [codeAnswer, setCodeAnswer] = useState("");
  const [selectedOption, setSelectedOption] = useState("");

  const hasOptions = Array.isArray(question?.options) && question.options.length > 0;
  const isMcq = hasOptions;

  const handleNext = () => {
    if (isMcq && !selectedOption) {
      toast.error(t("code.selectOption"));
      return;
    }
    if (!isMcq && !codeAnswer.trim()) {
      toast.error(t("code.provideAnswer"));
      return;
    }

    onSubmit({
      [isMcq ? "selected_option" : "code_answer"]: isMcq ? selectedOption : codeAnswer,
    });
  };

  const questionText = question?.text || question?.question || "";
  const badgeText = isMcq ? t("code.badgePseudocode") : t("code.badgeCoding");

  return (
    <QuestionShell
      badgeText={badgeText}
      questionNumber={questionNumber || 5}
      questionText={questionText}
      onNext={handleNext}
      endTime={endTime}
      submitting={submitting}
      isLastQuestion={isLastQuestion}
    >
      <div className="mt-4 flex flex-col gap-5">
        {/* Code Snippet Block (if provided) */}
        {question?.code_snippet && (
          <CodeBlock code={question.code_snippet} selectNone />
        )}

        {/* Input Area */}
        {isMcq ? (
          <div className="flex flex-col gap-3" role="radiogroup" aria-label="Answer options">
            {question.options.map((item, index) => {
              const isSelected = selectedOption === item;
              const letter = String.fromCharCode(65 + index); // A, B, C, D...
              const cleanItem = item.replace(/^[A-Za-z][.)]\s*/, "");

              return (
                <div
                  key={item}
                  role="radio"
                  aria-checked={isSelected}
                  tabIndex={0}
                  onClick={() => setSelectedOption(item)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelectedOption(item);
                    }
                  }}
                  className={`flex cursor-pointer select-none items-center gap-3 rounded-xl border p-4 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
                    isSelected
                      ? "border-blue-200 bg-blue-50/50 text-slate-800 shadow-sm"
                      : "border-slate-100 bg-slate-50/50 text-slate-600 hover:bg-slate-100/50"
                  }`}
                >
                  <div className="flex-shrink-0">
                    {isSelected ? (
                      <div className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-blue-500">
                        <div className="h-2.5 w-2.5 rounded-full bg-blue-500" />
                      </div>
                    ) : (
                      <div className="h-5 w-5 rounded-full border-2 border-slate-300 bg-white" />
                    )}
                  </div>
                  <span className="text-[15px]">
                    {letter}. {cleanItem}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <Textarea
            value={codeAnswer}
            onChange={(e) => setCodeAnswer(e.target.value)}
            onCopy={(e) => e.preventDefault()}
            onPaste={(e) => e.preventDefault()}
            onCut={(e) => e.preventDefault()}
            onContextMenu={(e) => e.preventDefault()}
            placeholder={t("code.placeholder")}
            className="min-h-[250px] resize-none rounded-2xl border-blue-200 px-4 py-3 font-mono focus-visible:ring-2 focus-visible:ring-blue-300"
          />
        )}
      </div>
    </QuestionShell>
  );
}
