import { useId, useRef, useState } from "react";
import QuestionShell from "../QuestionShell";
import CodeBlock from "../CodeBlock";
import OptionList from "../OptionList";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAnswerDraft } from "@/lib/answerDraft";
import {
  backspace,
  caretPosition,
  insertIndent,
  newline,
  shiftLines,
  typeChar,
} from "@/lib/codeEditing";

const MAX_CODE_CHARS = 10_000;

export default function CodeQuestion({
  question,
  onSubmit,
  questionNumber,
  endTime,
  submitting,
  isLastQuestion,
  draftKey,
}) {
  const { t } = useTranslation("questions");
  const [answer, setAnswer] = useAnswerDraft(draftKey);
  const [caret, setCaret] = useState(0);
  const textareaRef = useRef(null);
  const gutterRef = useRef(null);
  const statusId = useId();

  const isMcq = Array.isArray(question?.options) && question.options.length > 0;

  const handleNext = () => {
    if (isMcq && !answer) {
      toast.error(t("code.selectOption"));
      return;
    }
    if (!isMcq && !answer.trim()) {
      toast.error(t("code.provideAnswer"));
      return;
    }
    onSubmit({ [isMcq ? "selected_option" : "code_answer"]: answer });
  };

  const applyEdit = (edit) => {
    setAnswer(edit.text);
    setCaret(edit.start);
    requestAnimationFrame(() => {
      if (!textareaRef.current) return;
      textareaRef.current.selectionStart = edit.start;
      textareaRef.current.selectionEnd = edit.end;
    });
  };

  const handleKeyDown = (e) => {
    if (e.isComposing || e.nativeEvent?.isComposing) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const { selectionStart: start, selectionEnd: end } = e.currentTarget;
    let edit = null;

    if (e.key === "Tab") {
      e.preventDefault();
      edit =
        start === end && !e.shiftKey
          ? insertIndent(answer, start, end)
          : shiftLines(answer, start, end, e.shiftKey);
    } else if (e.key === "Enter") {
      edit = newline(answer, start, end);
    } else if (e.key === "Backspace") {
      edit = backspace(answer, start, end);
    } else if (e.key.length === 1) {
      edit = typeChar(answer, start, end, e.key);
    }

    if (!edit) return;
    e.preventDefault();
    applyEdit(edit);
  };

  const handlePaste = (e) => {
    e.preventDefault();
    toast.info(t("code.pasteDisabled"), { id: "paste-disabled" });
  };

  const lineCount = Math.max(1, answer.split("\n").length);
  const { line, column } = caretPosition(answer, Math.min(caret, answer.length));
  const overLimit = answer.length > MAX_CODE_CHARS;

  const questionText = question?.text || question?.question || "";
  const badgeText = isMcq ? t("code.badgePseudocode") : t("code.badgeCoding");

  return (
    <QuestionShell
      badgeText={badgeText}
      questionNumber={questionNumber}
      questionText={questionText}
      onNext={handleNext}
      endTime={endTime}
      submitting={submitting}
      isLastQuestion={isLastQuestion}
    >
      <div className="mt-4 flex flex-col gap-5">
        {question?.code_snippet && <CodeBlock code={question.code_snippet} selectNone />}

        {isMcq ? (
          <OptionList options={question.options} selected={answer} onSelect={setAnswer} />
        ) : (
          <div>
            <div className="relative flex h-80 min-h-[200px] max-h-[70vh] resize-y overflow-hidden rounded-2xl border border-blue-200 bg-[#f8fbff] shadow-sm focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-200">
              <div
                ref={gutterRef}
                aria-hidden="true"
                className="w-12 select-none overflow-hidden border-r border-blue-100 bg-slate-100/60 py-3 pr-3 text-right font-mono text-sm leading-6 text-slate-400"
              >
                {Array.from({ length: lineCount }, (_, i) => (
                  <div key={i}>{i + 1}</div>
                ))}
              </div>

              <textarea
                ref={textareaRef}
                value={answer}
                onChange={(e) => {
                  setAnswer(e.target.value);
                  setCaret(e.target.selectionStart);
                }}
                onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
                onKeyDown={handleKeyDown}
                onScroll={(e) => {
                  if (gutterRef.current) gutterRef.current.scrollTop = e.target.scrollTop;
                }}
                onCopy={(e) => e.preventDefault()}
                onPaste={handlePaste}
                onCut={(e) => e.preventDefault()}
                onDrop={(e) => e.preventDefault()}
                onContextMenu={(e) => e.preventDefault()}
                placeholder={t("code.placeholder")}
                aria-label={t("code.editorLabel", { number: questionNumber })}
                aria-describedby={statusId}
                spellCheck={false}
                autoCapitalize="off"
                autoComplete="off"
                autoCorrect="off"
                className="h-full flex-1 resize-none overflow-auto whitespace-pre bg-transparent px-4 py-3 font-mono text-sm leading-6 text-slate-800 placeholder:text-slate-400 focus:outline-none [tab-size:2]"
              />
            </div>

            <div
              id={statusId}
              className="mt-2 flex items-center justify-between px-1 text-xs text-slate-500"
            >
              <span>
                {t("code.position", { line, column })}
                <span className="mx-2">·</span>
                <span className={overLimit ? "font-semibold text-amber-600" : undefined}>
                  {t("code.characters", { count: answer.length, max: MAX_CODE_CHARS })}
                </span>
              </span>
              {answer.trim() && <span>{t("code.draftSaved")}</span>}
            </div>
          </div>
        )}
      </div>
    </QuestionShell>
  );
}
