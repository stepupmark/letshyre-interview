import { act, renderHook } from "@testing-library/react";
import { clearDrafts, draftKeyFor, readDraft, useAnswerDraft, writeDraft } from "./answerDraft";

const session = { interview_id: "i1", current_index: 10 };

describe("answerDraft", () => {
  beforeEach(() => sessionStorage.clear());

  it("keys drafts by interview and question", () => {
    expect(draftKeyFor(session)).toBe("answer_draft:i1:10");
    expect(draftKeyFor(null)).toBeNull();
  });

  it("restores a saved draft and keeps it in sync", () => {
    const key = draftKeyFor(session);
    writeDraft(key, "print(1)");

    const { result } = renderHook(() => useAnswerDraft(key));
    expect(result.current[0]).toBe("print(1)");

    act(() => result.current[1]("print(2)"));
    expect(readDraft(key)).toBe("print(2)");

    act(() => result.current[1](""));
    expect(sessionStorage.getItem(key)).toBeNull();
  });

  it("clears only answer drafts", () => {
    writeDraft(draftKeyFor(session), "x");
    sessionStorage.setItem("other", "keep");

    clearDrafts();

    expect(readDraft(draftKeyFor(session))).toBe("");
    expect(sessionStorage.getItem("other")).toBe("keep");
  });
});
