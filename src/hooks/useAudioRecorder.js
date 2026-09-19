import { useCallback, useEffect, useRef, useState } from "react";
import { logger } from "@/lib/logger";
import { recordViolationEvent } from "@/lib/violationLog";
import { whilePermissionPrompt } from "@/hooks/proctoring/useViolationMonitor";

const MIME_TYPES = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus", "audio/wav"];
// A freshly opened mic delivers silence for a moment, which clipped the first word.
export const WARMUP_MS = 300;
const LEVEL_INTERVAL_MS = 100;
export const SILENCE_PEAK = 0.02;
const MIN_BYTES = 1_000;
// Drivers emit brief mute blips, so only a sustained mute is worth telling the candidate.
export const MUTE_GRACE_MS = 2_000;
const DEVICE_KEY = "voice_input_device";

// Loopback and virtual cables let another app or person speak through the "mic".
// Matched by name only, so this stops casual misuse; voice matching covers the rest.
const VIRTUAL_INPUT =
  /cable output|vb-audio|voicemeeter|stereo mix|what u hear|wave out mix|blackhole|soundflower|loopback audio|virtual (audio|cable|mic)/i;

export const isVirtualInput = (label = "") => VIRTUAL_INPUT.test(label);

function readStoredDevice() {
  try {
    return sessionStorage.getItem(DEVICE_KEY) || "";
  } catch {
    return "";
  }
}

function storeDevice(id) {
  try {
    if (id) sessionStorage.setItem(DEVICE_KEY, id);
    else sessionStorage.removeItem(DEVICE_KEY);
  } catch {
    // storage blocked: the choice just won't carry to the next question
  }
}

const logVoice = (event) => recordViolationEvent({ source: "voice", outcome: "logged", ...event });

// Some browsers record formats they can't play back, so prefer one that does both.
function bestMimeType() {
  const probe = document.createElement("audio");
  const recordable = MIME_TYPES.filter((type) => MediaRecorder.isTypeSupported(type));
  return recordable.find((type) => probe.canPlayType(type)) || recordable[0] || "";
}

async function decodeRecording(blob) {
  const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OfflineCtx) return null;
  const context = new OfflineCtx(1, 1, 44_100);
  return context.decodeAudioData(await blob.arrayBuffer());
}

function peakOf(buffer) {
  let peak = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    for (const sample of buffer.getChannelData(channel)) {
      const value = Math.abs(sample);
      if (value > peak) peak = value;
    }
  }
  return peak;
}

function createLevelMeter(stream) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;

  const context = new AudioCtx();
  context.resume?.().catch(() => {});
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  context.createMediaStreamSource(stream).connect(analyser);
  const samples = new Float32Array(analyser.fftSize);

  return {
    read() {
      if (context.state !== "running") return null;
      analyser.getFloatTimeDomainData(samples);
      let peak = 0;
      for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
      return peak;
    },
    close() {
      context.close?.().catch(() => {});
    },
  };
}

function createBufferPlayer(buffer, onEnded) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const context = new AudioCtx();
  let source = null;
  let offset = 0;
  let startedAt = 0;
  let attempt = 0;

  return {
    fromBuffer: true,
    get paused() {
      return !source;
    },
    async play() {
      const current = ++attempt;
      await context.resume();
      if (current !== attempt) return;

      const node = context.createBufferSource();
      node.buffer = buffer;
      node.connect(context.destination);
      node.onended = () => {
        if (source !== node) return;
        source = null;
        offset = 0;
        onEnded();
      };
      source = node;
      startedAt = context.currentTime - offset;
      node.start(0, offset);
    },
    pause() {
      attempt++;
      if (!source) return;
      offset = context.currentTime - startedAt;
      const node = source;
      source = null;
      node.stop();
    },
    close() {
      context.close?.().catch(() => {});
    },
  };
}

export function useAudioRecorder() {
  const [status, setStatus] = useState("idle"); // idle | starting | recording | reviewing
  const [audioURL, setAudioURL] = useState(null);
  const [audioBlob, setAudioBlob] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState(null);
  const [level, setLevel] = useState(0);
  const [devices, setDevices] = useState([]);
  const [deviceId, setDeviceId] = useState(readStoredDevice);
  const [inputMuted, setInputMuted] = useState(false);

  const mountedRef = useRef(false);
  const takeRef = useRef(0);
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const meterRef = useRef(null);
  const levelTimerRef = useRef(null);
  const muteTimerRef = useRef(null);
  const urlRef = useRef(null);
  const bufferRef = useRef(null);
  const playerRef = useRef(null);
  const playerUrlRef = useRef(null);
  const devicesRef = useRef([]);
  const deviceIdRef = useRef(deviceId);

  const fail = useCallback((code) => setError({ code, at: Date.now() }), []);

  const rememberDevice = useCallback((id) => {
    deviceIdRef.current = id;
    setDeviceId(id);
    storeDevice(id);
  }, []);

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const all = await navigator.mediaDevices.enumerateDevices().catch(() => []);
    // Chrome on Windows lists every mic again as "Communications - …".
    const inputs = all.filter(
      (d) =>
        d.kind === "audioinput" &&
        d.deviceId &&
        d.deviceId !== "communications" &&
        !isVirtualInput(d.label),
    );
    if (!mountedRef.current) return;
    devicesRef.current = inputs;
    setDevices(inputs);

    // Before mic permission the list is empty, which says nothing about the saved choice.
    const chosen = deviceIdRef.current;
    if (!inputs.length || !chosen || inputs.some((d) => d.deviceId === chosen)) return;
    rememberDevice("");
    logVoice({ type: "MIC_CHANGED", device: inputs[0].label || null, reason: "device_removed" });
    // A mid-recording unplug has already told the candidate.
    setError((prev) =>
      prev?.code === "micDisconnected" ? prev : { code: "micSwitched", at: Date.now() },
    );
  }, [rememberDevice]);

  const selectDevice = useCallback(
    (id) => {
      if (id === deviceIdRef.current) return;
      rememberDevice(id);
      const device = devicesRef.current.find((d) => d.deviceId === id);
      logVoice({ type: "MIC_CHANGED", device: device?.label || null, reason: "candidate" });
    },
    [rememberDevice],
  );

  const releaseInput = useCallback(() => {
    clearInterval(levelTimerRef.current);
    levelTimerRef.current = null;
    clearTimeout(muteTimerRef.current);
    muteTimerRef.current = null;
    meterRef.current?.close();
    meterRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setLevel(0);
    setInputMuted(false);
  }, []);

  const releaseRecording = useCallback(() => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    bufferRef.current = null;
  }, []);

  const closePlayer = useCallback(() => {
    playerRef.current?.pause();
    playerRef.current?.close?.();
    playerRef.current = null;
    playerUrlRef.current = null;
  }, []);

  const stopPlayback = useCallback(() => {
    closePlayer();
    setIsPlaying(false);
  }, [closePlayer]);

  const startRecording = useCallback(async () => {
    if (streamRef.current) return;

    const take = ++takeRef.current;
    stopPlayback();
    releaseRecording();
    setAudioURL(null);
    setAudioBlob(null);
    setError(null);
    setStatus("starting");

    const open = (id) =>
      whilePermissionPrompt(
        navigator.mediaDevices.getUserMedia({ audio: id ? { deviceId: { exact: id } } : true }),
      );
    const preferred = deviceIdRef.current || devicesRef.current[0]?.deviceId || "";

    let stream;
    try {
      stream = await open(preferred).catch((err) => {
        if (!preferred || !["OverconstrainedError", "NotFoundError"].includes(err?.name)) throw err;
        return open("");
      });
    } catch (err) {
      logger.warn("[Recorder] microphone unavailable:", err?.name, err?.message);
      if (!mountedRef.current) return;
      fail("micUnavailable");
      setStatus("idle");
      return;
    }

    if (!mountedRef.current) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    const track = stream.getAudioTracks()[0];
    logger.log("[Recorder] input", {
      label: track?.label,
      muted: track?.muted,
      settings: track?.getSettings?.(),
    });

    if (isVirtualInput(track?.label)) {
      stream.getTracks().forEach((t) => t.stop());
      logVoice({ type: "VIRTUAL_MIC", outcome: "blocked", device: track.label });
      fail("virtualMic");
      setStatus("idle");
      return;
    }

    streamRef.current = stream;
    refreshDevices();

    let dropped = false;
    track?.addEventListener?.("ended", () => {
      if (streamRef.current !== stream) return;
      dropped = true;
      logVoice({ type: "MIC_DISCONNECTED", device: track.label || null });
      const active = recorderRef.current;
      if (active && active.state !== "inactive") {
        active.stop();
        return;
      }
      releaseInput();
      fail("micDisconnected");
      setStatus("idle");
    });

    const onMute = () => {
      if (streamRef.current !== stream) return;
      clearTimeout(muteTimerRef.current);
      muteTimerRef.current = setTimeout(() => setInputMuted(true), MUTE_GRACE_MS);
    };
    track?.addEventListener?.("mute", onMute);
    track?.addEventListener?.("unmute", () => {
      clearTimeout(muteTimerRef.current);
      setInputMuted(false);
    });
    if (track?.muted) onMute();

    const meter = createLevelMeter(stream);
    meterRef.current = meter;
    if (meter) {
      levelTimerRef.current = setInterval(() => {
        const peak = meter.read();
        if (peak !== null) setLevel(peak);
      }, LEVEL_INTERVAL_MS);
    }

    const mimeType = bestMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
    const chunks = [];
    let startedAt = 0;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    recorder.onstop = async () => {
      releaseInput();
      recorderRef.current = null;
      const isCurrent = () => mountedRef.current && take === takeRef.current;

      if (dropped) {
        if (!isCurrent()) return;
        fail("micDisconnected");
        setStatus("idle");
        return;
      }

      const type = recorder.mimeType || mimeType;
      const blob = new Blob(chunks, type ? { type } : undefined);

      let buffer = null;
      let decodeError = null;
      if (blob.size >= MIN_BYTES) {
        try {
          buffer = await decodeRecording(blob);
        } catch (err) {
          decodeError = err;
        }
      }

      const peak = buffer ? peakOf(buffer) : null;
      logger.log("[Recorder] stopped", {
        type,
        bytes: blob.size,
        ms: Date.now() - startedAt,
        decodedSeconds: buffer?.duration,
        peak,
        decodeError: decodeError?.name,
      });

      if (!isCurrent()) return;
      if (decodeError) {
        fail("unplayable");
        setStatus("idle");
        return;
      }
      if (blob.size < MIN_BYTES || (peak !== null && peak < SILENCE_PEAK)) {
        fail("noSound");
        setStatus("idle");
        return;
      }

      logVoice({
        type: "RECORDING",
        device: track?.label || null,
        seconds: buffer ? Math.round(buffer.duration) : null,
      });
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      bufferRef.current = buffer;
      setAudioBlob(blob);
      setAudioURL(url);
      setStatus("reviewing");
    };

    await new Promise((resolve) => setTimeout(resolve, WARMUP_MS));
    if (!mountedRef.current || streamRef.current !== stream) return;

    recorderRef.current = recorder;
    startedAt = Date.now();
    recorder.start();
    setStatus("recording");
  }, [fail, refreshDevices, releaseInput, releaseRecording, stopPlayback]);

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
      return;
    }
    if (streamRef.current) {
      releaseInput();
      setStatus("idle");
    }
  }, [releaseInput]);

  const retake = useCallback(() => {
    takeRef.current++;
    stopPlayback();
    releaseRecording();
    setAudioURL(null);
    setAudioBlob(null);
    setError(null);
    setStatus("idle");
  }, [releaseRecording, stopPlayback]);

  const togglePlayback = useCallback(async () => {
    if (!audioURL) return;

    const current = playerRef.current;
    if (current && !current.paused) {
      current.pause();
      setIsPlaying(false);
      return;
    }

    if (!current || playerUrlRef.current !== audioURL) {
      closePlayer();
      const player = new Audio(audioURL);
      player.addEventListener("ended", () => setIsPlaying(false));
      playerRef.current = player;
      playerUrlRef.current = audioURL;
    }

    const player = playerRef.current;
    setIsPlaying(true);
    try {
      await player.play();
      return;
    } catch (err) {
      // Pausing before playback starts rejects the pending play; that's not a failure.
      if (err?.name === "AbortError") return;
      logger.warn("[Recorder] playback failed:", err?.name, err?.message);
      if (err?.name !== "NotSupportedError" || !bufferRef.current || player.fromBuffer) {
        setIsPlaying(false);
        fail(err?.name === "NotAllowedError" ? "playbackBlocked" : "playbackFailed");
        return;
      }
    }

    // The element can't load this blob, but it decoded fine, so play the samples directly.
    player.pause();
    const fallback = createBufferPlayer(bufferRef.current, () => setIsPlaying(false));
    playerRef.current = fallback;
    playerUrlRef.current = audioURL;
    try {
      await fallback.play();
    } catch (err) {
      logger.warn("[Recorder] fallback playback failed:", err?.name, err?.message);
      setIsPlaying(false);
      fail(err?.name === "NotAllowedError" ? "playbackBlocked" : "playbackFailed");
    }
  }, [audioURL, closePlayer, fail]);

  useEffect(() => {
    mountedRef.current = true;
    refreshDevices();
    navigator.mediaDevices?.addEventListener?.("devicechange", refreshDevices);

    return () => {
      mountedRef.current = false;
      navigator.mediaDevices?.removeEventListener?.("devicechange", refreshDevices);
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") recorder.stop();
      releaseInput();
      closePlayer();
      releaseRecording();
    };
  }, [closePlayer, refreshDevices, releaseInput, releaseRecording]);

  return {
    status,
    audioURL,
    audioBlob,
    isPlaying,
    error,
    level,
    inputMuted,
    devices,
    deviceId: deviceId || devices[0]?.deviceId || "",
    selectDevice,
    startRecording,
    stopRecording,
    retake,
    togglePlayback,
  };
}
