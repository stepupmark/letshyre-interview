import { useState } from "react";
import QuestionShell from "../QuestionShell";
import { useTranslation } from "react-i18next";

import { toast } from "sonner";

export default function McqQuestion({
  question,
  onSubmit,
  questionNumber,
  endTime,
  submitting,
  isLastQuestion,
}) {
  const { t } = useTranslation("questions");
  const [selected, setSelected] = useState("");

  const handleNext = () => {
    if (!selected) {
      toast.error(t("mcq.selectOption"));
      return;
    }
    onSubmit({
      selected_option: selected,
    });
  };

  const questionText = question?.text || question?.question || "";
  const options = question?.options || [];

  return (
    <QuestionShell
      badgeText={t("mcq.badge")}
      questionNumber={questionNumber || 1}
      questionText={questionText}
      onNext={handleNext}
      endTime={endTime}
      submitting={submitting}
      isLastQuestion={isLastQuestion}
    >
      <div className="mt-6 flex flex-col gap-3" role="radiogroup" aria-label="Answer options">
        {options.map((item, index) => {
          const isSelected = selected === item;
          const letter = String.fromCharCode(65 + index); // A, B, C, D...
          const cleanItem = item.replace(/^[A-Za-z][.)]\s*/, "");

          return (
            <div
              key={item}
              role="radio"
              aria-checked={isSelected}
              tabIndex={0}
              onClick={() => setSelected(item)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSelected(item);
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
    </QuestionShell>
  );
}
