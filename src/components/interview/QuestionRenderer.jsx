import { lazy, memo, Suspense } from "react";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

// Lazy-loaded so each question type ships in its own chunk and only the type
// actually rendered is downloaded.
const TypingQuestion = lazy(() => import("./questions/TypingQuestion"));
const McqQuestion = lazy(() => import("./questions/McqQuestion"));
const VoiceQuestion = lazy(() => import("./questions/VoiceQuestion"));
const CodeQuestion = lazy(() => import("./questions/CodeQuestion"));

function QuestionLoader() {
  const { t } = useTranslation("questions");
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
      <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      <p className="text-[15px] font-medium text-slate-500">{t("loader.preparing")}</p>
    </div>
  );
}

// Dispatches to the right question component. Kept as its own module-level
// component (rather than assigning the picked component to a local variable
// during render) so React can statically see which components exist.
function QuestionBody({ type, ...props }) {
  switch (type) {
    case "MCQ":
      return <McqQuestion {...props} />;
    case "VOICE":
    case "AUDIO":
      return <VoiceQuestion {...props} />;
    case "CODE":
    case "PSEUDO_CODE":
    case "PSEUDOCODE_MCQ":
    case "SUDO_CODE":
      return <CodeQuestion {...props} />;
    default:
      return <TypingQuestion {...props} />;
  }
}

// memo: with the timer extracted into its own self-ticking <CountdownTimer>,
// this component's props are stable between seconds, so it (and the heavy
// question subtree) no longer re-renders on every 1s tick of the parent.
function QuestionRenderer({
  question,
  onSubmit,
  questionNumber,
  endTime,
  submitting,
  isLastQuestion,
}) {
  // Active session but no question yet (e.g. backend returned no next_question).
  // Show a loading state instead of a blank panel.
  if (!question) {
    return <QuestionLoader />;
  }

  return (
    <Suspense fallback={<QuestionLoader />}>
      {/* key={questionNumber} fully remounts on each question, cleanly resetting
          any internal state (textarea contents, selected option, recording). */}
      <QuestionBody
        key={questionNumber}
        type={question.type}
        question={question}
        onSubmit={onSubmit}
        questionNumber={questionNumber}
        endTime={endTime}
        submitting={submitting}
        isLastQuestion={isLastQuestion}
      />
    </Suspense>
  );
}

export default memo(QuestionRenderer);
