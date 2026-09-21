import { lazy, memo, Suspense, useState } from "react";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
    case "CODING":
    case "PSEUDO_CODE":
    case "PSEUDOCODE_MCQ":
    case "SUDO_CODE":
      return <CodeQuestion {...props} />;
    default:
      return <TypingQuestion {...props} />;
  }
}

function FinalSubmitDialog({ open, onCancel, onConfirm, submitting }) {
  const { t } = useTranslation("questions");
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t("shell.finalConfirmTitle")}</DialogTitle>
          <DialogDescription>{t("shell.finalConfirmBody")}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">{t("shell.goBack")}</Button>
          </DialogClose>
          <Button onClick={onConfirm} disabled={submitting}>
            {t("shell.submitInterview")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
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
  draftKey,
}) {
  const [pending, setPending] = useState(null);

  // Active session but no question yet (e.g. backend returned no next_question).
  // Show a loading state instead of a blank panel.
  if (!question) {
    return <QuestionLoader />;
  }

  // Only the last answer ends the interview, so only that one asks first.
  const submit = isLastQuestion ? (payload) => setPending({ payload }) : onSubmit;

  const confirm = () => {
    const { payload } = pending;
    setPending(null);
    onSubmit(payload);
  };

  return (
    <Suspense fallback={<QuestionLoader />}>
      {/* key={questionNumber} fully remounts on each question, cleanly resetting
          any internal state (textarea contents, selected option, recording). */}
      <QuestionBody
        key={questionNumber}
        type={question.type}
        question={question}
        onSubmit={submit}
        questionNumber={questionNumber}
        endTime={endTime}
        submitting={submitting}
        isLastQuestion={isLastQuestion}
        draftKey={draftKey}
      />
      <FinalSubmitDialog
        open={pending !== null}
        onCancel={() => setPending(null)}
        onConfirm={confirm}
        submitting={submitting}
      />
    </Suspense>
  );
}

export default memo(QuestionRenderer);
