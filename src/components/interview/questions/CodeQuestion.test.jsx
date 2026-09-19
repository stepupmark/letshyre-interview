import { render, screen, fireEvent, act } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import CodeQuestion from "./CodeQuestion";
import questionsEn from "@/i18n/locales/en/questions.json";

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    resources: { en: { questions: questionsEn } },
    ns: ["questions"],
    defaultNS: "questions",
    interpolation: { escapeValue: false },
  });
});

describe("CodeQuestion Code Editor Enhancement", () => {
  const defaultProps = {
    question: {
      text: "Write a function that returns the reverse of a string.",
      options: [],
    },
    onSubmit: vi.fn(),
    questionNumber: 5,
    endTime: Date.now() + 60000,
    submitting: false,
    isLastQuestion: false,
  };

  it("renders the code editor with line numbers gutter and mono font", () => {
    render(<CodeQuestion {...defaultProps} />);

    const textarea = screen.getByRole("textbox");
    expect(textarea).toBeInTheDocument();
    expect(textarea.className).toContain("font-mono");

    // Line 1 should be visible in gutter
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("inserts 2 spaces on Tab key press without losing focus", () => {
    render(<CodeQuestion {...defaultProps} />);
    const textarea = screen.getByRole("textbox");

    act(() => {
      fireEvent.change(textarea, { target: { value: "def hello():" } });
      textarea.selectionStart = textarea.selectionEnd = "def hello():".length;
      fireEvent.keyDown(textarea, { key: "Tab" });
    });

    expect(textarea.value).toBe("def hello():  ");
  });

  it("preserves auto-indentation on Enter key press", () => {
    render(<CodeQuestion {...defaultProps} />);
    const textarea = screen.getByRole("textbox");

    act(() => {
      fireEvent.change(textarea, { target: { value: "  line1" } });
      textarea.selectionStart = textarea.selectionEnd = "  line1".length;
      fireEvent.keyDown(textarea, { key: "Enter" });
    });

    expect(textarea.value).toBe("  line1\n  ");
  });

  it("adds additional indent when line ends with a colon or brace", () => {
    render(<CodeQuestion {...defaultProps} />);
    const textarea = screen.getByRole("textbox");

    act(() => {
      fireEvent.change(textarea, { target: { value: "def foo():" } });
      textarea.selectionStart = textarea.selectionEnd = "def foo():".length;
      fireEvent.keyDown(textarea, { key: "Enter" });
    });

    expect(textarea.value).toBe("def foo():\n  ");
  });

  it("indents multiple selected lines on Tab", () => {
    render(<CodeQuestion {...defaultProps} />);
    const textarea = screen.getByRole("textbox");

    act(() => {
      fireEvent.change(textarea, { target: { value: "line 1\nline 2\nline 3" } });
      // Select from middle of line 1 to middle of line 2
      textarea.selectionStart = 2;
      textarea.selectionEnd = 10;
      fireEvent.keyDown(textarea, { key: "Tab" });
    });

    expect(textarea.value).toBe("  line 1\n  line 2\nline 3");
  });

  it("un-indents multiple selected lines on Shift+Tab", () => {
    render(<CodeQuestion {...defaultProps} />);
    const textarea = screen.getByRole("textbox");

    act(() => {
      fireEvent.change(textarea, { target: { value: "  line 1\n  line 2\n  line 3" } });
      textarea.selectionStart = 2;
      textarea.selectionEnd = 15;
      fireEvent.keyDown(textarea, { key: "Tab", shiftKey: true });
    });

    expect(textarea.value).toBe("line 1\nline 2\n  line 3");
  });

  it("indents a selection inside one line instead of replacing it", () => {
    render(<CodeQuestion {...defaultProps} />);
    const textarea = screen.getByRole("textbox");

    act(() => {
      fireEvent.change(textarea, { target: { value: "return value;" } });
      textarea.selectionStart = 7;
      textarea.selectionEnd = 12;
      fireEvent.keyDown(textarea, { key: "Tab" });
    });

    expect(textarea.value).toBe("  return value;");
  });

  it("outdents a selection inside one line instead of deleting it", () => {
    render(<CodeQuestion {...defaultProps} />);
    const textarea = screen.getByRole("textbox");

    act(() => {
      fireEvent.change(textarea, { target: { value: "  return value;" } });
      textarea.selectionStart = 9;
      textarea.selectionEnd = 14;
      fireEvent.keyDown(textarea, { key: "Tab", shiftKey: true });
    });

    expect(textarea.value).toBe("return value;");
  });

  it("outdents the current line on Shift+Tab wherever the caret is", () => {
    render(<CodeQuestion {...defaultProps} />);
    const textarea = screen.getByRole("textbox");

    act(() => {
      fireEvent.change(textarea, { target: { value: "    x = 1" } });
      textarea.selectionStart = textarea.selectionEnd = 0;
      fireEvent.keyDown(textarea, { key: "Tab", shiftKey: true });
    });

    expect(textarea.value).toBe("  x = 1");
  });

  it("keeps focus in the editor when Tab is pressed", () => {
    render(<CodeQuestion {...defaultProps} />);
    const textarea = screen.getByRole("textbox");

    const notPrevented = fireEvent.keyDown(textarea, { key: "Tab" });

    expect(notPrevented).toBe(false);
  });

  it("does not insert newlines or indent when IME is composing on Enter", () => {
    render(<CodeQuestion {...defaultProps} />);
    const textarea = screen.getByRole("textbox");

    act(() => {
      fireEvent.change(textarea, { target: { value: "hello" } });
      textarea.selectionStart = textarea.selectionEnd = 5;
      fireEvent.keyDown(textarea, { key: "Enter", isComposing: true });
    });

    expect(textarea.value).toBe("hello");
  });

  it("prevents copy, paste, cut, and contextmenu for anti-cheat", () => {
    render(<CodeQuestion {...defaultProps} />);
    const textarea = screen.getByRole("textbox");

    const copyEvent = fireEvent.copy(textarea);
    expect(copyEvent).toBe(false); // fireEvent returns false when defaultPrevented is true

    const pasteEvent = fireEvent.paste(textarea);
    expect(pasteEvent).toBe(false);

    const cutEvent = fireEvent.cut(textarea);
    expect(cutEvent).toBe(false);

    const contextMenuEvent = fireEvent.contextMenu(textarea);
    expect(contextMenuEvent).toBe(false);
  });
});
