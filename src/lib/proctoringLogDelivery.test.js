import { submitProctoringLogs } from "@/services/proctoring.api";
import { deleteLog, loadLogs } from "@/lib/proctoringLogStore";
import {
  ABANDONED_AFTER_MS,
  DELIVERY,
  deliverLog,
  payloadFromEntry,
  resendKeptLogs,
} from "./proctoringLogDelivery";

vi.mock("@/services/proctoring.api", () => ({ submitProctoringLogs: vi.fn() }));
vi.mock("@/lib/proctoringLogStore", () => ({
  loadLogs: vi.fn(),
  deleteLog: vi.fn(),
  saveLog: vi.fn(),
}));

const NOW = 1_800_000_000_000;

const payload = { interview_id: "i1", session_id: "s1", payload: { records: [{ n: 1 }] } };

const entry = (overrides = {}) => ({
  session_id: "old",
  interview_id: "i0",
  run_id: "r0",
  proctoring_token: "pt",
  records: [{ n: 1 }],
  ended: true,
  updated_at: NOW,
  ...overrides,
});

const httpError = (status) =>
  Object.assign(new Error(`status ${status}`), { response: { status } });

beforeEach(() => {
  vi.clearAllMocks();
  submitProctoringLogs.mockResolvedValue({});
  deleteLog.mockResolvedValue(undefined);
  loadLogs.mockResolvedValue([]);
  sessionStorage.setItem("ac", "site-token");
});

afterEach(() => {
  delete window.electronAPI;
  sessionStorage.clear();
});

describe("deliverLog", () => {
  it("posts the batch itself outside the desktop app", async () => {
    await expect(deliverLog(payload)).resolves.toBe(DELIVERY.SENT);
    expect(submitProctoringLogs).toHaveBeenCalledWith(payload);
  });

  it("hands the batch to the desktop app, with the page's token, and does not post it", async () => {
    const submitProctoringLog = vi.fn().mockResolvedValue({ ok: true });
    window.electronAPI = { submitProctoringLog };

    await expect(deliverLog(payload)).resolves.toBe(DELIVERY.HANDED_OVER);
    expect(submitProctoringLog).toHaveBeenCalledWith(payload, "site-token");
    expect(submitProctoringLogs).not.toHaveBeenCalled();
  });

  it("posts it directly when the app refuses or the hand-over throws", async () => {
    window.electronAPI = { submitProctoringLog: vi.fn().mockResolvedValue({ ok: false }) };
    await expect(deliverLog(payload)).resolves.toBe(DELIVERY.SENT);

    window.electronAPI = { submitProctoringLog: vi.fn().mockRejectedValue(new Error("no")) };
    await expect(deliverLog(payload)).resolves.toBe(DELIVERY.SENT);
    expect(submitProctoringLogs).toHaveBeenCalledTimes(2);
  });

  it("rejects when the direct post fails", async () => {
    submitProctoringLogs.mockRejectedValue(new Error("Network Error"));
    await expect(deliverLog(payload)).rejects.toThrow("Network Error");
  });
});

describe("resendKeptLogs", () => {
  it("sends an ended log from an earlier session and forgets it", async () => {
    const kept = entry();
    loadLogs.mockResolvedValue([kept]);

    await expect(resendKeptLogs("current", NOW)).resolves.toBe(1);
    expect(submitProctoringLogs).toHaveBeenCalledWith(payloadFromEntry(kept));
    expect(deleteLog).toHaveBeenCalledWith("old");
  });

  it("leaves the current session's log and one another tab may still be writing", async () => {
    loadLogs.mockResolvedValue([
      entry({ session_id: "current" }),
      entry({ session_id: "live", ended: false, updated_at: NOW - 60_000 }),
    ]);

    await expect(resendKeptLogs("current", NOW)).resolves.toBe(0);
    expect(submitProctoringLogs).not.toHaveBeenCalled();
  });

  it("sends a log nobody has written to for a while, even if it never ended", async () => {
    loadLogs.mockResolvedValue([entry({ ended: false, updated_at: NOW - ABANDONED_AFTER_MS })]);
    await expect(resendKeptLogs("current", NOW)).resolves.toBe(1);
  });

  it("skips a log already sent while its page unloaded", async () => {
    loadLogs.mockResolvedValue([entry({ sent_at_unload: true })]);
    await expect(resendKeptLogs("current", NOW)).resolves.toBe(0);
    expect(submitProctoringLogs).not.toHaveBeenCalled();
  });

  it("keeps a log that still can't be sent, and drops one the backend refuses", async () => {
    loadLogs.mockResolvedValue([entry({ session_id: "a" }), entry({ session_id: "b" })]);
    submitProctoringLogs
      .mockRejectedValueOnce(new Error("Network Error"))
      .mockRejectedValueOnce(httpError(400));

    await expect(resendKeptLogs("current", NOW)).resolves.toBe(0);
    expect(deleteLog).toHaveBeenCalledTimes(1);
    expect(deleteLog).toHaveBeenCalledWith("b");
  });
});
