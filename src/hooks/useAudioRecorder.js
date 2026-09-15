import { useCallback, useEffect, useRef, useState } from "react";
import { logger } from "@/lib/logger";

const MIME_TYPES = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus", "audio/wav"];
// A freshly opened mic delivers silence for a moment, which clipped the first word.
export const WARMUP_MS = 300;
const LEVEL_INTERVAL_MS = 100;
// Speech peaks well above this; staying under it means a muted or wrong input.
export const SILENCE_PEAK = 0.02;
const MIN_BYTES = 1_000;

const bestMimeType = () => MIME_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) || "";

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
    // null while the context is suspended, so a blocked meter never reads as silence.
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

export function useAudioRecorder() {
  const [status, setStatus] = useState("idle"); // idle | starting | recording | reviewing
  const [audioURL, setAudioURL] = useState(null);
  const [audioBlob, setAudioBlob] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState(null);
  const [level, setLevel] = useState(0);
  const [devices, setDevices] = useState([]);
  const [deviceId, setDeviceId] = useState("");

  const mountedRef = useRef(false);
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const meterRef = useRef(null);
  const levelTimerRef = useRef(null);
  const peakRef = useRef(null);
  const urlRef = useRef(null);
  const playerRef = useRef(null);
  const playerUrlRef = useRef(null);

  const fail = useCallback((code) => setError({ code, at: Date.now() }), []);

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const all = await navigator.mediaDevices.enumerateDevices().catch(() => []);
    const inputs = all.filter((d) => d.kind === "audioinput" && d.deviceId);
    if (!mountedRef.current) return;
    setDevices(inputs);
    setDeviceId((current) => (inputs.some((d) => d.deviceId === current) ? current : ""));
  }, []);

  const releaseInput = useCallback(() => {
    clearInterval(levelTimerRef.current);
    levelTimerRef.current = null;
    meterRef.current?.close();
    meterRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setLevel(0);
  }, []);

  const releaseUrl = useCallback(() => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
  }, []);

  const stopPlayback = useCallback(() => {
    playerRef.current?.pause();
    playerRef.current = null;
    playerUrlRef.current = null;
    setIsPlaying(false);
  }, []);

  const startRecording = useCallback(async () => {
    if (streamRef.current) return;

    stopPlayback();
    releaseUrl();
    setAudioURL(null);
    setAudioBlob(null);
    setError(null);
    setStatus("starting");

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
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
    streamRef.current = stream;

    const track = stream.getAudioTracks()[0];
    logger.log("[Recorder] input", {
      label: track?.label,
      muted: track?.muted,
      settings: track?.getSettings?.(),
    });
    refreshDevices();

    const meter = createLevelMeter(stream);
    meterRef.current = meter;
    peakRef.current = null;
    let recording = false;
    if (meter) {
      levelTimerRef.current = setInterval(() => {
        const peak = meter.read();
        if (peak === null) return;
        if (recording) peakRef.current = Math.max(peakRef.current ?? 0, peak);
        setLevel(peak);
      }, LEVEL_INTERVAL_MS);
    }

    const mimeType = bestMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
    const chunks = [];
    let startedAt = 0;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    recorder.onstop = () => {
      const peak = peakRef.current;
      releaseInput();
      recorderRef.current = null;

      const type = recorder.mimeType || mimeType;
      const blob = new Blob(chunks, type ? { type } : undefined);
      logger.log("[Recorder] stopped", {
        type,
        bytes: blob.size,
        ms: Date.now() - startedAt,
        peak,
      });

      if (!mountedRef.current) return;
      if (blob.size < MIN_BYTES || (peak !== null && peak < SILENCE_PEAK)) {
        fail("noSound");
        setStatus("idle");
        return;
      }

      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      setAudioBlob(blob);
      setAudioURL(url);
      setStatus("reviewing");
    };

    await new Promise((resolve) => setTimeout(resolve, WARMUP_MS));
    if (!mountedRef.current || streamRef.current !== stream) return;

    recorderRef.current = recorder;
    recording = true;
    startedAt = Date.now();
    recorder.start();
    setStatus("recording");
  }, [deviceId, fail, refreshDevices, releaseInput, releaseUrl, stopPlayback]);

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
    stopPlayback();
    releaseUrl();
    setAudioURL(null);
    setAudioBlob(null);
    setError(null);
    setStatus("idle");
  }, [releaseUrl, stopPlayback]);

  const togglePlayback = useCallback(async () => {
    if (!audioURL) return;

    const current = playerRef.current;
    if (current && !current.paused) {
      current.pause();
      setIsPlaying(false);
      return;
    }

    if (!current || playerUrlRef.current !== audioURL) {
      const player = new Audio(audioURL);
      player.addEventListener("ended", () => setIsPlaying(false));
      playerRef.current = player;
      playerUrlRef.current = audioURL;
    }
    setIsPlaying(true);
    try {
      await playerRef.current.play();
    } catch (err) {
      // Pausing before playback starts rejects the pending play; that's not a failure.
      if (err?.name === "AbortError") return;
      logger.warn("[Recorder] playback failed:", err?.name, err?.message);
      setIsPlaying(false);
      fail("playbackFailed");
    }
  }, [audioURL, fail]);

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
      playerRef.current?.pause();
      releaseUrl();
    };
  }, [refreshDevices, releaseInput, releaseUrl]);

  return {
    status,
    audioURL,
    audioBlob,
    isPlaying,
    error,
    level,
    devices,
    deviceId,
    setDeviceId,
    startRecording,
    stopRecording,
    retake,
    togglePlayback,
  };
}
