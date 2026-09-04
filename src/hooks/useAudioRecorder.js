import { useState, useRef, useCallback, useEffect } from "react";

const getBestMimeType = () => {
  const types = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus", "audio/wav"];
  return types.find((t) => MediaRecorder.isTypeSupported(t)) || "";
};

export function useAudioRecorder() {
  const [status, setStatus] = useState("idle"); // idle | recording | reviewing
  const [audioURL, setAudioURL] = useState(null);
  const [audioBlob, setAudioBlob] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState(null);
  
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const audioPlayerRef = useRef(new Audio());

  const cleanup = useCallback(() => {
    if (audioURL) {
      URL.revokeObjectURL(audioURL);
    }
  }, [audioURL]);

  const startRecording = useCallback(async () => {
    try {
      cleanup();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = getBestMimeType();

      mediaRecorderRef.current = new MediaRecorder(stream, mimeType ? { mimeType } : {});
      audioChunksRef.current = [];

      mediaRecorderRef.current.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorderRef.current.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        const url = URL.createObjectURL(blob);
        setAudioBlob(blob);
        setAudioURL(url);
        setStatus("reviewing");
        
        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorderRef.current.start();
      setStatus("recording");
      setError(null);
    } catch {
      setError("Microphone access denied or hardware error.");
      setStatus("idle");
    }
  }, [cleanup]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const retake = useCallback(() => {
    cleanup();
    setAudioURL(null);
    setAudioBlob(null);
    setStatus("idle");
    setIsPlaying(false);
  }, [cleanup]);

  const togglePlayback = useCallback(() => {
    if (!audioURL) return;

    if (isPlaying) {
      audioPlayerRef.current.pause();
      setIsPlaying(false);
    } else {
      audioPlayerRef.current.src = audioURL;
      audioPlayerRef.current.play();
      setIsPlaying(true);
      
      audioPlayerRef.current.onended = () => {
        setIsPlaying(false);
      };
    }
  }, [audioURL, isPlaying]);

  useEffect(() => {
    return () => {
      cleanup();
      if (mediaRecorderRef.current?.state !== "inactive") {
        mediaRecorderRef.current?.stop();
      }
    };
  }, [cleanup]);

  return {
    status,
    audioURL,
    audioBlob,
    isPlaying,
    error,
    startRecording,
    stopRecording,
    retake,
    togglePlayback,
  };
}
