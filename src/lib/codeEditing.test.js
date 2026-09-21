import { backspace, caretPosition, newline, typeChar } from "./codeEditing";

describe("typeChar", () => {
  it("closes a bracket and leaves the caret inside", () => {
    expect(typeChar("f", 1, 1, "(")).toEqual({ text: "f()", start: 2, end: 2 });
  });

  it("wraps the selection instead of replacing it", () => {
    expect(typeChar("a + b", 0, 5, "(")).toEqual({ text: "(a + b)", start: 1, end: 6 });
  });

  it("types over a closer that is already there", () => {
    expect(typeChar("f()", 2, 2, ")")).toEqual({ text: "f()", start: 3, end: 3 });
  });

  it("does not pair a quote typed inside a word", () => {
    expect(typeChar("don", 3, 3, "'")).toBeNull();
  });

  it("does not pair a bracket typed right before a word", () => {
    expect(typeChar("x", 0, 0, "(")).toBeNull();
  });

  it("outdents a closing brace typed on an indented blank line", () => {
    expect(typeChar("if {\n    ", 9, 9, "}")).toEqual({ text: "if {\n  }", start: 8, end: 8 });
  });

  it("leaves other characters to the browser", () => {
    expect(typeChar("a", 1, 1, "b")).toBeNull();
  });
});

describe("newline", () => {
  it("keeps the indent and indents after an opener", () => {
    expect(newline("  if x:", 7, 7).text).toBe("  if x:\n    ");
  });

  it("moves the closer to its own line between a pair", () => {
    expect(newline("f() {}", 5, 5)).toEqual({ text: "f() {\n  \n}", start: 8, end: 8 });
  });
});

describe("backspace", () => {
  it("removes an empty pair together", () => {
    expect(backspace("f()", 2, 2)).toEqual({ text: "f", start: 1, end: 1 });
  });

  it("leaves a normal backspace alone", () => {
    expect(backspace("ab", 2, 2)).toBeNull();
  });
});

describe("caretPosition", () => {
  it("reports 1-based line and column", () => {
    expect(caretPosition("ab\ncde", 5)).toEqual({ line: 2, column: 3 });
    expect(caretPosition("", 0)).toEqual({ line: 1, column: 1 });
  });
});
