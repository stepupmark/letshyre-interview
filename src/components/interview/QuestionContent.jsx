import { cn } from "@/lib/utils";
import CodeBlock from "./CodeBlock";

/**
 * QuestionContent — renders a question's Markdown as safe React elements.
 *
 * Coding questions arrive as Markdown (headings, ordered/unordered lists,
 * inline code, fenced code blocks, bold). We parse a focused subset into JSX
 * — never `dangerouslySetInnerHTML` — so the output is XSS-safe by
 * construction. Plain, non-Markdown prompts (MCQ / typing / voice) fall
 * through as a single paragraph, so it's safe for every question type.
 */

/** Splits a line into text / inline-code / bold React nodes. */
function parseInline(text, keyPrefix) {
  const nodes = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)/g;
  let last = 0;
  let key = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[1]) {
      nodes.push(
        <code
          key={`${keyPrefix}-${key++}`}
          className="rounded bg-blue-50 px-1.5 py-0.5 font-mono text-[0.85em] text-blue-700"
        >
          {m[1].slice(1, -1)}
        </code>,
      );
    } else if (m[2]) {
      nodes.push(
        <strong key={`${keyPrefix}-${key++}`} className="font-semibold text-slate-800">
          {m[2].slice(2, -2)}
        </strong>,
      );
    }
    last = re.lastIndex;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/** Renders multi-line text, preserving intentional line breaks. */
function renderMultiline(text, keyPrefix) {
  const lines = text.split("\n");
  return lines.flatMap((line, i) => {
    const parsed = parseInline(line, `${keyPrefix}-l${i}`);
    return i < lines.length - 1
      ? [...parsed, <br key={`${keyPrefix}-br${i}`} />]
      : parsed;
  });
}

const isHeading = (l) => /^\s*#{1,6}\s+/.test(l);
const isUl = (l) => /^\s*[-*]\s+/.test(l);
const isOl = (l) => /^\s*\d+\.\s+/.test(l);
const isFence = (l) => /^\s*```/.test(l);

/** Groups the Markdown source into block descriptors. */
function parseBlocks(md) {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (isFence(line)) {
      const code = [];
      i++;
      while (i < lines.length && !isFence(lines[i])) {
        code.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      blocks.push({ type: "code", content: code.join("\n") });
      continue;
    }

    const h = line.match(/^\s*(#{1,6})\s+(.*)$/);
    if (h) {
      blocks.push({ type: "heading", level: Math.min(h[1].length, 3), content: h[2] });
      i++;
      continue;
    }

    if (isUl(line)) {
      const items = [];
      while (i < lines.length && isUl(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      blocks.push({ type: "ul", items });
      continue;
    }

    if (isOl(line)) {
      const items = [];
      while (i < lines.length && isOl(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      blocks.push({ type: "ol", items });
      continue;
    }

    if (line.trim() === "") {
      i++;
      continue;
    }

    const para = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !isFence(lines[i]) &&
      !isHeading(lines[i]) &&
      !isUl(lines[i]) &&
      !isOl(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push({ type: "p", content: para.join("\n") });
  }

  return blocks;
}

export default function QuestionContent({ source, className, selectNone = false }) {
  if (!source) return null;
  const blocks = parseBlocks(String(source));

  return (
    <div className={cn("flex flex-col gap-3", selectNone && "select-none", className)}>
      {blocks.map((b, idx) => {
        const key = `b${idx}`;
        switch (b.type) {
          case "heading":
            return (
              <p
                key={key}
                className={cn(
                  "font-bold text-slate-800",
                  b.level === 1 ? "text-[1.05em]" : "text-[0.95em]",
                  idx > 0 && "mt-1",
                )}
              >
                {parseInline(b.content, key)}
              </p>
            );
          case "code":
            return <CodeBlock key={key} code={b.content} selectNone={selectNone} />;
          case "ul":
            return (
              <ul key={key} className="flex list-disc flex-col gap-1 ps-5">
                {b.items.map((it, j) => (
                  <li key={`${key}-${j}`}>{parseInline(it, `${key}-${j}`)}</li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={key} className="flex list-decimal flex-col gap-1 ps-5">
                {b.items.map((it, j) => (
                  <li key={`${key}-${j}`}>{parseInline(it, `${key}-${j}`)}</li>
                ))}
              </ol>
            );
          default:
            return (
              <p key={key} className="leading-relaxed">
                {renderMultiline(b.content, key)}
              </p>
            );
        }
      })}
    </div>
  );
}
