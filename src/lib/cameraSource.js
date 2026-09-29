import contract from "@/contract/interview-contract.json";

const { nameKeywords, allowed } = contract.virtualCameras;

export const VIRTUAL_ONLY = "virtual_only";

const SIZE = { width: 1280, height: 720 };

/** Same rule as the desktop agent: a keyword match that isn't on the allowed list. */
export function isVirtualCamera(label) {
  const name = String(label ?? "").toLowerCase();
  if (!name || allowed.some((ok) => name.includes(ok))) return false;
  return nameKeywords.some((kw) => name.includes(kw));
}

const labelOf = (stream) => stream.getVideoTracks()[0]?.label ?? "";
const stop = (stream) => stream.getTracks().forEach((t) => t.stop());

function virtualOnly() {
  const err = new Error("Only a virtual camera is available");
  err.code = VIRTUAL_ONLY;
  return err;
}

/**
 * Opens the webcam, never a virtual camera (OBS, ManyCam...). The default
 * device is tried first; if that is virtual, the first real one by name is
 * opened instead. Throws VIRTUAL_ONLY when there is no real one.
 */
export async function openRealCamera(media = navigator.mediaDevices) {
  const first = await media.getUserMedia({ video: { facingMode: "user", ...SIZE }, audio: false });
  if (!isVirtualCamera(labelOf(first))) return first;
  stop(first);

  // Labels are only filled in once camera permission is granted, which it now is.
  const devices = await media.enumerateDevices().catch(() => []);
  const real = devices.find(
    (d) => d.kind === "videoinput" && d.deviceId && d.label && !isVirtualCamera(d.label),
  );
  if (!real) throw virtualOnly();

  const stream = await media.getUserMedia({
    video: { deviceId: { exact: real.deviceId }, ...SIZE },
    audio: false,
  });
  if (isVirtualCamera(labelOf(stream))) {
    stop(stream);
    throw virtualOnly();
  }
  return stream;
}
