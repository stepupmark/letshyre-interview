import { Textarea } from "@/components/ui/textarea";
import QuestionShell from "../QuestionShell";
import { useTranslation } from "react-i18next";
import { useAnswerDraft } from "@/lib/answerDraft";

import { toast } from "sonner";

export default function TypingQuestion({
  question,
  onSubmit,
  questionNumber,
  endTime,
  submitting,
  isLastQuestion,
  draftKey,
}) {
  const { t } = useTranslation("questions");
  const [value, setValue] = useAnswerDraft(draftKey);

  const handleNext = () => {
    if (!value.trim()) {
      toast.error(t("typing.provideAnswer"));
      return;
    }
    onSubmit({
      answer_text: value,
    });
  };

  const questionText = question?.text || question?.question || "";

  return (
    <QuestionShell
      badgeText={t("typing.badge")}
      questionNumber={questionNumber}
      questionText={questionText}
      onNext={handleNext}
      endTime={endTime}
      submitting={submitting}
      isLastQuestion={isLastQuestion}
    >
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onCopy={(e) => e.preventDefault()}
        onPaste={(e) => e.preventDefault()}
        onCut={(e) => e.preventDefault()}
        onContextMenu={(e) => e.preventDefault()}
        placeholder={t("typing.placeholder")}
        className="min-h-[250px] resize-none rounded-2xl border-blue-200 px-4 py-3 focus-visible:ring-2 focus-visible:ring-blue-300"
      />

      <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
        <span>{t("typing.characters", { count: value.length })}</span>
        <span>{t("typing.answerTip")}</span>
      </div>
    </QuestionShell>
  );
}
