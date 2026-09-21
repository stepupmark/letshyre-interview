import QuestionShell from "../QuestionShell";
import OptionList from "../OptionList";
import { useTranslation } from "react-i18next";
import { useAnswerDraft } from "@/lib/answerDraft";

import { toast } from "sonner";

export default function McqQuestion({
  question,
  onSubmit,
  questionNumber,
  endTime,
  submitting,
  isLastQuestion,
  draftKey,
}) {
  const { t } = useTranslation("questions");
  const [selected, setSelected] = useAnswerDraft(draftKey);

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

  return (
    <QuestionShell
      badgeText={t("mcq.badge")}
      questionNumber={questionNumber}
      questionText={questionText}
      onNext={handleNext}
      endTime={endTime}
      submitting={submitting}
      isLastQuestion={isLastQuestion}
    >
      <OptionList
        className="mt-6"
        options={question?.options || []}
        selected={selected}
        onSelect={setSelected}
      />
    </QuestionShell>
  );
}
