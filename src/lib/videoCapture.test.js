import { captureSample } from "./videoCapture";

const READY_VIDEO = {
  readyState: 4,
  paused: false,
  ended: false,
  videoWidth: 1280,
  videoHeight: 720,
};

let canvases = [];

function fakeCanvas() {
  const ctx = { drawImage: vi.fn() };
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ctx,
    toDataURL: vi.fn(() => `data:image/jpeg;base64,${btoa(`canvas${canvases.indexOf(canvas)}`)}`),
    ctx,
  };
  return canvas;
}

beforeEach(() => {
  vi.spyOn(document, "createElement").mockImplementation((tag) => {
    if (tag !== "canvas") throw new Error(`unexpected element ${tag}`);
    const canvas = fakeCanvas();
    canvases.push(canvas);
    return canvas;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("captureSample", () => {
  it("reads the video once and serves both consumers from that frame", () => {
    const sample = captureSample(READY_VIDEO, {
      maxWidth: 640,
      maxHeight: 480,
      quality: 0.7,
      fileQuality: 0.92,
    });

    const [source, scaled] = canvases;
    expect(source.ctx.drawImage).toHaveBeenCalledTimes(1);
    expect(source.ctx.drawImage).toHaveBeenCalledWith(READY_VIDEO, 0, 0, 1280, 720);
    expect(scaled.ctx.drawImage).toHaveBeenCalledTimes(1);
    expect(scaled.ctx.drawImage).toHaveBeenCalledWith(source, 0, 0, 640, 360);

    expect([source.width, source.height]).toEqual([1280, 720]);
    expect([scaled.width, scaled.height]).toEqual([640, 360]);
    expect(source.toDataURL).toHaveBeenCalledWith("image/jpeg", 0.92);
    expect(scaled.toDataURL).toHaveBeenCalledWith("image/jpeg", 0.7);

    expect(sample.frame).toBeTruthy();
    expect(sample.file).toBeInstanceOf(File);
  });

  it("returns null when the camera has no decodable frame", () => {
    expect(captureSample({ ...READY_VIDEO, readyState: 0 })).toBeNull();
    expect(captureSample(null)).toBeNull();
  });
});
