import { useState, useRef } from "react";
import QuestionShell from "../QuestionShell";
import CodeBlock from "../CodeBlock";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

const INDENT = "  ";

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
  const textareaRef = useRef(null);
  const gutterRef = useRef(null);

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

  const handleScroll = (e) => {
    if (gutterRef.current) {
      gutterRef.current.scrollTop = e.target.scrollTop;
    }
  };

  const moveCaret = (start, end = start) => {
    requestAnimationFrame(() => {
      if (!textareaRef.current) return;
      textareaRef.current.selectionStart = start;
      textareaRef.current.selectionEnd = end;
    });
  };

  const replaceText = (from, to, text, caret) => {
    setCodeAnswer(codeAnswer.slice(0, from) + text + codeAnswer.slice(to));
    moveCaret(caret);
  };

  // Indents or outdents every line the selection touches, so selected code is
  // never replaced the way a plain text box would.
  const shiftLines = (start, end, outdent) => {
    const lineStart = codeAnswer.lastIndexOf("\n", start - 1) + 1;
    const lastChar = end > start && codeAnswer[end - 1] === "\n" ? end - 1 : end;
    const nextBreak = codeAnswer.indexOf("\n", lastChar);
    const blockEnd = nextBreak === -1 ? codeAnswer.length : nextBreak;

    const deltas = [];
    const lines = codeAnswer
      .slice(lineStart, blockEnd)
      .split("\n")
      .map((line) => {
        if (!outdent) {
          deltas.push(INDENT.length);
          return INDENT + line;
        }
        const removed = line.startsWith(INDENT) ? INDENT.length : line.startsWith(" ") ? 1 : 0;
        deltas.push(-removed);
        return line.slice(removed);
      });

    const total = deltas.reduce((sum, delta) => sum + delta, 0);
    if (total === 0) return;

    setCodeAnswer(codeAnswer.slice(0, lineStart) + lines.join("\n") + codeAnswer.slice(blockEnd));
    const newStart = Math.max(lineStart, start + deltas[0]);
    moveCaret(newStart, start === end ? newStart : Math.max(newStart, end + total));
  };

  const handleKeyDown = (e) => {
    const textarea = e.currentTarget;
    const { selectionStart, selectionEnd } = textarea;

    if (e.key === "Tab") {
      e.preventDefault();
      if (selectionStart === selectionEnd && !e.shiftKey) {
        replaceText(selectionStart, selectionEnd, INDENT, selectionStart + INDENT.length);
        return;
      }
      shiftLines(selectionStart, selectionEnd, e.shiftKey);
      return;
    }

    if (e.key === "Enter") {
      if (e.isComposing || e.nativeEvent?.isComposing) {
        return;
      }
      e.preventDefault();
      const currentLine = codeAnswer.slice(0, selectionStart).split("\n").at(-1);
      const indent = currentLine.match(/^[ \t]*/)[0];
      const opensBlock = /[{:]$/.test(currentLine.trimEnd());
      const insert = "\n" + indent + (opensBlock ? INDENT : "");
      replaceText(selectionStart, selectionEnd, insert, selectionStart + insert.length);
    }
  };

  const lineCount = Math.max(1, codeAnswer.split("\n").length);
  const lineNumbers = Array.from({ length: lineCount }, (_, i) => i + 1);

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
          <div className="relative flex min-h-[280px] overflow-hidden rounded-2xl border border-blue-200 bg-[#f8fbff] shadow-sm focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-200">
            {/* Line Numbers Gutter */}
            <div
              ref={gutterRef}
              aria-hidden="true"
              className="w-12 select-none overflow-hidden border-r border-blue-100 bg-slate-100/60 py-3 pr-3 text-right font-mono text-sm leading-6 text-slate-400"
            >
              {lineNumbers.map((num) => (
                <div key={num}>{num}</div>
              ))}
            </div>

            {/* Code Input */}
            <textarea
              ref={textareaRef}
              value={codeAnswer}
              onChange={(e) => setCodeAnswer(e.target.value)}
              onKeyDown={handleKeyDown}
              onScroll={handleScroll}
              onCopy={(e) => e.preventDefault()}
              onPaste={(e) => e.preventDefault()}
              onCut={(e) => e.preventDefault()}
              onContextMenu={(e) => e.preventDefault()}
              placeholder={t("code.placeholder")}
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              autoCorrect="off"
              className="flex-1 resize-none bg-transparent px-4 py-3 font-mono text-sm leading-6 text-slate-800 placeholder:text-slate-400 focus:outline-none [tab-size:2] whitespace-pre overflow-x-auto"
              rows={Math.max(10, lineCount)}
            />
          </div>
        )}
      </div>
    </QuestionShell>
  );
}
