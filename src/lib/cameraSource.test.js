import { isVirtualCamera, openRealCamera, VIRTUAL_ONLY } from "./cameraSource";

const fakeStream = (label) => {
  const track = { label, stop: vi.fn() };
  return { track, getVideoTracks: () => [track], getTracks: () => [track] };
};

function fakeMedia({ defaultLabel, devices = [], byId = {} }) {
  const opened = [];
  return {
    opened,
    getUserMedia: vi.fn(async ({ video }) => {
      const id = video.deviceId?.exact;
      const stream = fakeStream(id ? byId[id] : defaultLabel);
      opened.push(stream);
      return stream;
    }),
    enumerateDevices: vi.fn(async () => devices),
  };
}

const cam = (deviceId, label) => ({ kind: "videoinput", deviceId, label });

describe("isVirtualCamera", () => {
  it.each(["OBS Virtual Camera", "ManyCam Virtual Webcam", "Snap Camera", "XSplit VCam"])(
    "flags %s",
    (label) => expect(isVirtualCamera(label)).toBe(true),
  );

  it.each(["Integrated Camera", "Logitech BRIO", "Camera (NVIDIA Broadcast)", "", undefined])(
    "lets %s through",
    (label) => expect(isVirtualCamera(label)).toBe(false),
  );
});

describe("openRealCamera", () => {
  it("keeps the default camera when it is real", async () => {
    const media = fakeMedia({ defaultLabel: "Integrated Camera" });
    const stream = await openRealCamera(media);
    expect(stream.track.label).toBe("Integrated Camera");
    expect(media.enumerateDevices).not.toHaveBeenCalled();
  });

  it("swaps a virtual default for the first real webcam", async () => {
    const media = fakeMedia({
      defaultLabel: "OBS Virtual Camera",
      devices: [cam("obs", "OBS Virtual Camera"), cam("int", "Integrated Camera")],
      byId: { int: "Integrated Camera" },
    });
    const stream = await openRealCamera(media);
    expect(stream.track.label).toBe("Integrated Camera");
    expect(media.getUserMedia).toHaveBeenLastCalledWith({
      video: expect.objectContaining({ deviceId: { exact: "int" } }),
      audio: false,
    });
    expect(media.opened[0].track.stop).toHaveBeenCalled();
  });

  it("refuses when every camera is virtual", async () => {
    const media = fakeMedia({
      defaultLabel: "OBS Virtual Camera",
      devices: [
        cam("obs", "OBS Virtual Camera"),
        { kind: "audioinput", deviceId: "m", label: "Mic" },
      ],
    });
    await expect(openRealCamera(media)).rejects.toMatchObject({ code: VIRTUAL_ONLY });
    expect(media.opened[0].track.stop).toHaveBeenCalled();
  });

  it("refuses when the chosen device still turns out virtual", async () => {
    const media = fakeMedia({
      defaultLabel: "ManyCam Virtual Webcam",
      devices: [cam("x", "USB Camera")],
      byId: { x: "ManyCam Virtual Webcam" },
    });
    await expect(openRealCamera(media)).rejects.toMatchObject({ code: VIRTUAL_ONLY });
    expect(media.opened[1].track.stop).toHaveBeenCalled();
  });
});
