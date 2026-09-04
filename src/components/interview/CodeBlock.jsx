import { cn } from "@/lib/utils";

/**
 * A language-agnostic code block: monospace, preserves formatting, scrolls
 * sideways for long lines. Used for coding answers and pseudocode snippets in
 * both the interview flow and the scorecard.
 *
 * `selectNone` disables text selection (interview copy-protection).
 */
export default function CodeBlock({ code, selectNone = false, className }) {
  return (
    <pre
      className={cn(
        "overflow-x-auto rounded-xl border border-blue-100 bg-[#f8fbff] p-4",
        selectNone && "select-none",
        className,
      )}
    >
      <code className="block whitespace-pre font-mono text-sm leading-relaxed text-slate-700 [tab-size:4]">
        {code}
      </code>
    </pre>
  );
}
