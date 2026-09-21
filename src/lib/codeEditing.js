export const INDENT = "  ";

const PAIRS = { "(": ")", "[": "]", "{": "}", '"': '"', "'": "'", "`": "`" };
const CLOSERS = new Set([")", "]", "}"]);
const QUOTES = new Set(['"', "'", "`"]);
const WORD = /[\w$]/;

const lineStartOf = (text, pos) => text.lastIndexOf("\n", pos - 1) + 1;

const replace = (text, from, to, insert, caret) => ({
  text: text.slice(0, from) + insert + text.slice(to),
  start: caret,
  end: caret,
});

export const insertIndent = (text, start, end) =>
  replace(text, start, end, INDENT, start + INDENT.length);

// Shifts every line the selection touches so selected code is never replaced.
export function shiftLines(text, start, end, outdent) {
  const lineStart = lineStartOf(text, start);
  const lastChar = end > start && text[end - 1] === "\n" ? end - 1 : end;
  const nextBreak = text.indexOf("\n", lastChar);
  const blockEnd = nextBreak === -1 ? text.length : nextBreak;

  const deltas = [];
  const lines = text
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
  if (total === 0) return null;

  const newStart = Math.max(lineStart, start + deltas[0]);
  return {
    text: text.slice(0, lineStart) + lines.join("\n") + text.slice(blockEnd),
    start: newStart,
    end: start === end ? newStart : Math.max(newStart, end + total),
  };
}

export function newline(text, start, end) {
  const line = text.slice(lineStartOf(text, start), start);
  const indent = line.match(/^[ \t]*/)[0];
  const trimmed = line.trimEnd();
  const opensBlock = /[{[(:]$/.test(trimmed);
  const splitsPair = /[{[(]$/.test(trimmed) && CLOSERS.has(text[end]);

  const insert = "\n" + indent + (opensBlock ? INDENT : "");
  const after = splitsPair ? "\n" + indent : "";
  return replace(text, start, end, insert + after, start + insert.length);
}

export function backspace(text, start, end) {
  if (start !== end || start === 0) return null;
  const close = PAIRS[text[start - 1]];
  if (!close || close !== text[start]) return null;
  return replace(text, start - 1, start + 1, "", start - 1);
}

export function typeChar(text, start, end, ch) {
  const prev = text[start - 1];
  const next = text[end];

  if (start === end && next === ch && (CLOSERS.has(ch) || QUOTES.has(ch))) {
    return { text, start: start + 1, end: start + 1 };
  }

  if (ch === "}" && start === end) {
    const lineStart = lineStartOf(text, start);
    const before = text.slice(lineStart, start);
    if (before && !before.trim()) {
      const kept = before.slice(0, Math.max(0, before.length - INDENT.length));
      return replace(text, lineStart, start, kept + "}", lineStart + kept.length + 1);
    }
    return null;
  }

  const close = PAIRS[ch];
  if (!close) return null;

  if (start !== end) {
    return {
      text: text.slice(0, start) + ch + text.slice(start, end) + close + text.slice(end),
      start: start + 1,
      end: end + 1,
    };
  }

  if (next && WORD.test(next)) return null;
  if (QUOTES.has(ch) && prev && WORD.test(prev)) return null;
  return replace(text, start, end, ch + close, start + 1);
}

export function caretPosition(text, pos) {
  const before = text.slice(0, pos);
  return { line: before.split("\n").length, column: pos - lineStartOf(text, pos) + 1 };
}
