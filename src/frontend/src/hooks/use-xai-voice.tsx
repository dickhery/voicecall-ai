/**
 * useXaiVoice now controls the server-side telephony bridge.
 *
 * Browser responsibilities:
 * 1. Create/update the IC call-history record.
 * 2. Ask the Windows-hosted voice server to place the Twilio call.
 * 3. Ask that same server to end the Twilio call when requested.
 *
 * Twilio Media Streams and xAI Realtime audio stay on the server.
 */

import { CallStatus } from "@/backend";
import { useReserveCall, useUpdateCallStatus } from "@/hooks/use-backend";
import {
  endVoiceServerCall,
  getLiveAudioMonitorUrl,
  getVoiceServerCallSession,
  startVoiceServerCall,
  steerVoiceServerCall,
} from "@/lib/voice-server";
import type { CallCaptureOptions } from "@/lib/voice-server";
import { useCallStore } from "@/stores/call-store";
import type { CallPreset } from "@/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export type XaiCallStatus =
  | "idle"
  | "initiating"
  | "queued"
  | "connecting"
  | "in_call"
  | "completed"
  | "error";

export interface XaiVoiceState {
  status: XaiCallStatus;
  recipient: string;
  presetName: string;
  durationSecs: number;
  isMuted: boolean;
  errorMessage: string | null;
  audioLevels: number[];
  liveAudioAvailable: boolean;
  isListeningLive: boolean;
  liveAudioError: string | null;
  isSendingSteeringPrompt: boolean;
  steeringError: string | null;
}

export interface XaiVoiceControls {
  startCall: (
    preset: CallPreset,
    recipient: string,
    captureOptions?: CallCaptureOptions,
  ) => Promise<void>;
  endCall: () => void;
  toggleMute: () => void;
  toggleLiveAudio: () => Promise<void>;
  stopLiveAudio: () => void;
  steerConversation: (prompt: string) => Promise<void>;
}

const WAVEFORM_BARS = 20;
const MONITOR_SAMPLE_RATE = 8000;
const MONITOR_JITTER_SECONDS = 0.12;
const MONITOR_FADE_SAMPLES = 8;

type MonitorChannel = "caller" | "assistant";

interface MonitorAudioMessage {
  type: "audio";
  channel?: MonitorChannel;
  payload?: string;
}

function decodeBase64Payload(payload: string): Uint8Array {
  const binary = window.atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function decodeMuLawSample(value: number): number {
  const sample = ~value & 0xff;
  const sign = sample & 0x80;
  const exponent = (sample >> 4) & 0x07;
  const mantissa = sample & 0x0f;
  let magnitude = ((mantissa << 3) + 0x84) << exponent;
  magnitude -= 0x84;
  const pcm = sign ? -magnitude : magnitude;
  return Math.max(-1, Math.min(1, pcm / 32768));
}

function writeDecodedMuLawSamples(bytes: Uint8Array, samples: Float32Array) {
  let sumSquares = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    const decoded = decodeMuLawSample(bytes[i]);
    sumSquares += decoded * decoded;
    const fadeIn = Math.min(1, i / MONITOR_FADE_SAMPLES);
    const fadeOut = Math.min(1, (bytes.length - i - 1) / MONITOR_FADE_SAMPLES);
    samples[i] = decoded * Math.min(fadeIn, fadeOut);
  }
  return Math.sqrt(sumSquares / Math.max(1, bytes.length));
}

export function useXaiVoice(): XaiVoiceState & XaiVoiceControls {
  const [status, setStatus] = useState<XaiCallStatus>("idle");
  const [recipient, setRecipient] = useState("");
  const [presetName, setPresetName] = useState("");
  const [durationSecs, setDurationSecs] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [audioLevels, setAudioLevels] = useState<number[]>(
    Array(WAVEFORM_BARS).fill(0),
  );
  const [liveAudioAvailable, setLiveAudioAvailable] = useState(false);
  const [isListeningLive, setIsListeningLive] = useState(false);
  const [liveAudioError, setLiveAudioError] = useState<string | null>(null);
  const [isSendingSteeringPrompt, setIsSendingSteeringPrompt] = useState(false);
  const [steeringError, setSteeringError] = useState<string | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const queuePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const activeCallIdRef = useRef<bigint | null>(null);
  const activeCallSidRef = useRef<string | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const monitorTokenRef = useRef<string | null>(null);
  const monitorWsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const monitorInputNodeRef = useRef<AudioNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const nextPlaybackTimeRef = useRef<Record<MonitorChannel, number>>({
    caller: 0,
    assistant: 0,
  });

  const reserveCall = useReserveCall();
  const updateCallStatus = useUpdateCallStatus();
  const { setActiveCall, clearCall } = useCallStore();

  const cleanupTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setAudioLevels(Array(WAVEFORM_BARS).fill(0));
  }, []);

  const cleanupQueuePolling = useCallback(() => {
    if (queuePollRef.current) {
      clearInterval(queuePollRef.current);
      queuePollRef.current = null;
    }
  }, []);

  const stopLiveAudio = useCallback(() => {
    if (monitorWsRef.current) {
      monitorWsRef.current.close();
      monitorWsRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      void audioContextRef.current.close();
    }
    audioContextRef.current = null;
    monitorInputNodeRef.current = null;
    gainNodeRef.current = null;
    nextPlaybackTimeRef.current = { caller: 0, assistant: 0 };
    setIsListeningLive(false);
  }, []);

  const playMonitorAudio = useCallback(
    (payload: string, channel: MonitorChannel = "assistant") => {
      const audioContext = audioContextRef.current;
      const monitorInputNode = monitorInputNodeRef.current;
      if (!audioContext || audioContext.state === "closed" || !monitorInputNode)
        return;

      const bytes = decodeBase64Payload(payload);
      if (bytes.length === 0) return;

      const buffer = audioContext.createBuffer(
        1,
        bytes.length,
        MONITOR_SAMPLE_RATE,
      );
      const samples = buffer.getChannelData(0);
      const rms = writeDecodedMuLawSamples(bytes, samples);

      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(monitorInputNode);

      const nextByChannel = nextPlaybackTimeRef.current;
      const queuedAt = nextByChannel[channel] || 0;
      const startAt =
        queuedAt > audioContext.currentTime
          ? queuedAt
          : audioContext.currentTime + MONITOR_JITTER_SECONDS;
      source.start(startAt);
      nextByChannel[channel] = startAt + buffer.duration;

      setAudioLevels((levels) => {
        const peak = Math.min(1, rms * 3.5);
        return [...levels.slice(1), peak];
      });
    },
    [],
  );

  const startLiveAudio = useCallback(async () => {
    const sessionId = activeSessionIdRef.current;
    const monitorToken = monitorTokenRef.current;
    if (!sessionId || !monitorToken) {
      toast.error("Live audio is not available for this call");
      return;
    }
    if (monitorWsRef.current?.readyState === WebSocket.OPEN) return;

    const AudioContextCtor =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextCtor) {
      toast.error("Live audio is not supported in this browser");
      return;
    }

    const audioContext = new AudioContextCtor();
    const highpass = audioContext.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = 80;
    highpass.Q.value = 0.7;
    const lowpass = audioContext.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = 3600;
    lowpass.Q.value = 0.7;
    const compressor = audioContext.createDynamicsCompressor();
    compressor.threshold.value = -24;
    compressor.knee.value = 18;
    compressor.ratio.value = 3;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.18;
    const gainNode = audioContext.createGain();
    gainNode.gain.value = 0.95;
    highpass.connect(lowpass);
    lowpass.connect(compressor);
    compressor.connect(gainNode);
    gainNode.connect(audioContext.destination);
    audioContextRef.current = audioContext;
    monitorInputNodeRef.current = highpass;
    gainNodeRef.current = gainNode;
    nextPlaybackTimeRef.current = {
      caller: audioContext.currentTime + MONITOR_JITTER_SECONDS,
      assistant: audioContext.currentTime + MONITOR_JITTER_SECONDS,
    };
    await audioContext.resume();

    const ws = new WebSocket(
      await getLiveAudioMonitorUrl({ sessionId, monitorToken }),
    );
    monitorWsRef.current = ws;
    setLiveAudioError(null);

    ws.onopen = () => {
      setIsListeningLive(true);
      toast.success("Live audio on");
    };
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data)) as
          | MonitorAudioMessage
          | { type: "ended" | "error"; error?: string };
        if (message.type === "audio" && message.payload) {
          playMonitorAudio(message.payload, message.channel || "assistant");
        } else if (message.type === "ended") {
          stopLiveAudio();
        } else if (message.type === "error") {
          throw new Error(message.error || "Live audio failed.");
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Live audio failed.";
        setLiveAudioError(message);
      }
    };
    ws.onerror = () => {
      setLiveAudioError("Live audio connection failed.");
      toast.error("Live audio connection failed");
    };
    ws.onclose = () => {
      monitorWsRef.current = null;
      setIsListeningLive(false);
    };
  }, [playMonitorAudio, stopLiveAudio]);

  const resetAfterDelay = useCallback(() => {
    setTimeout(() => {
      setStatus("idle");
      setDurationSecs(0);
      setRecipient("");
      setPresetName("");
      setErrorMessage(null);
      setIsMuted(false);
      setLiveAudioAvailable(false);
      setLiveAudioError(null);
      setIsSendingSteeringPrompt(false);
      setSteeringError(null);
    }, 3000);
  }, []);

  const startDurationTimer = useCallback(() => {
    startTimeRef.current = Date.now();
    setDurationSecs(0);
    timerRef.current = setInterval(() => {
      setDurationSecs(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
  }, []);

  const markServerCallConnected = useCallback(
    (serverCall: {
      callSid: string;
      sessionId: string;
      monitorToken?: string;
      liveAudio?: unknown;
    }) => {
      activeCallSidRef.current = serverCall.callSid;
      activeSessionIdRef.current = serverCall.sessionId;
      monitorTokenRef.current = serverCall.monitorToken || null;
      setLiveAudioAvailable(Boolean(serverCall.monitorToken));
      setStatus("in_call");
      startDurationTimer();
    },
    [startDurationTimer],
  );

  const startQueuePolling = useCallback(
    (sessionId: string) => {
      cleanupQueuePolling();

      const poll = async () => {
        try {
          const serverCall = await getVoiceServerCallSession(sessionId);
          if (serverCall.callSid) {
            cleanupQueuePolling();
            markServerCallConnected({
              callSid: serverCall.callSid,
              sessionId: serverCall.sessionId,
              monitorToken: serverCall.monitorToken,
              liveAudio: serverCall.liveAudio,
            });
            toast.success("Queued call placed");
            return;
          }
          if (serverCall.queuePosition) {
            setErrorMessage(`Waiting for a free line. Position ${serverCall.queuePosition}.`);
          }
        } catch (err) {
          cleanupQueuePolling();
          const message =
            err instanceof Error ? err.message : "Queued call status failed";
          setStatus("error");
          setErrorMessage(message);
          toast.error(`Queued call failed: ${message}`);
          cleanupTimer();
          stopLiveAudio();
          clearCall();
        }
      };

      queuePollRef.current = setInterval(() => void poll(), 2000);
      void poll();
    },
    [
      cleanupQueuePolling,
      markServerCallConnected,
      cleanupTimer,
      stopLiveAudio,
      clearCall,
    ],
  );

  const startCall = useCallback(
    async (
      preset: CallPreset,
      recipientPhone: string,
      captureOptions?: CallCaptureOptions,
    ) => {
      stopLiveAudio();
      setStatus("initiating");
      setRecipient(recipientPhone);
      setPresetName(preset.name);
      setErrorMessage(null);
      setLiveAudioAvailable(false);
      setLiveAudioError(null);
      setSteeringError(null);
      activeCallIdRef.current = null;
      activeCallSidRef.current = null;
      activeSessionIdRef.current = null;
      monitorTokenRef.current = null;

      try {
        const reservationResult = await reserveCall.mutateAsync({
          recipientPhone,
          presetId: preset.id,
        });
        if (reservationResult.__kind__ === "err") {
          throw new Error(reservationResult.err);
        }

        const {
          callId,
          id: reservationId,
          callToken,
          allowedSeconds,
        } = reservationResult.ok;
        if (!callToken) {
          throw new Error("Reservation token was not returned by the backend.");
        }
        activeCallIdRef.current = callId;
        setActiveCall(callId, recipientPhone, preset.id);

        setStatus("connecting");
        const serverCall = await startVoiceServerCall({
          recipientPhone,
          preset,
          callId,
          reservationId,
          callToken,
          captureOptions,
        });

        activeSessionIdRef.current = serverCall.sessionId;
        monitorTokenRef.current = serverCall.monitorToken || null;
        if (serverCall.queued || !serverCall.callSid) {
          setStatus("queued");
          setErrorMessage(
            serverCall.queuePosition
              ? `Waiting for a free line. Position ${serverCall.queuePosition}.`
              : "Waiting for a free line.",
          );
          startQueuePolling(serverCall.sessionId);
          toast.info("All lines are busy. Your call is queued.", {
            description: serverCall.queuePosition
              ? `Queue position ${serverCall.queuePosition}`
              : undefined,
          });
          return;
        }

        markServerCallConnected(serverCall);
        toast.success("Call placed", {
          description: `${Math.floor(Number(allowedSeconds) / 60)} paid minutes reserved`,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        setStatus("error");
        setErrorMessage(message);
        toast.error(`Call failed: ${message}`);

        if (activeCallIdRef.current !== null) {
          updateCallStatus.mutate({
            callId: activeCallIdRef.current,
            status: CallStatus.failed,
            transcript: null,
          });
        }

        cleanupTimer();
        cleanupQueuePolling();
        stopLiveAudio();
        setLiveAudioAvailable(false);
        setSteeringError(null);
        clearCall();
      }
    },
    [
      reserveCall,
      setActiveCall,
      markServerCallConnected,
      startQueuePolling,
      updateCallStatus,
      cleanupTimer,
      cleanupQueuePolling,
      stopLiveAudio,
      clearCall,
    ],
  );

  const endCall = useCallback(() => {
    setStatus("completed");
    cleanupTimer();
    cleanupQueuePolling();
    stopLiveAudio();
    setLiveAudioAvailable(false);
    setIsSendingSteeringPrompt(false);
    setSteeringError(null);

    const callSid = activeCallSidRef.current;
    const sessionId = activeSessionIdRef.current;
    if (callSid || sessionId) {
      endVoiceServerCall({ callSid, sessionId }).catch((err) => {
        const message = err instanceof Error ? err.message : "Unknown error";
        toast.error(`Unable to end Twilio call: ${message}`);
      });
    }

    activeCallIdRef.current = null;
    activeCallSidRef.current = null;
    activeSessionIdRef.current = null;
    monitorTokenRef.current = null;
    clearCall();
    resetAfterDelay();
  }, [
    cleanupTimer,
    cleanupQueuePolling,
    stopLiveAudio,
    clearCall,
    resetAfterDelay,
  ]);

  const toggleMute = useCallback(() => {
    setIsMuted((value) => !value);
    toast.info("Use the phone keypad or handset mute for live call audio.");
  }, []);

  const toggleLiveAudio = useCallback(async () => {
    if (isListeningLive) {
      stopLiveAudio();
      toast.info("Live audio off");
      return;
    }
    await startLiveAudio();
  }, [isListeningLive, startLiveAudio, stopLiveAudio]);

  const steerConversation = useCallback(async (prompt: string) => {
    const cleanPrompt = prompt.trim();
    const sessionId = activeSessionIdRef.current;
    const monitorToken = monitorTokenRef.current;

    if (!cleanPrompt) {
      setSteeringError("Enter live guidance before sending.");
      return;
    }
    if (status !== "in_call" || !sessionId || !monitorToken) {
      setSteeringError("Live guidance is available once the call is connected.");
      return;
    }

    setIsSendingSteeringPrompt(true);
    setSteeringError(null);
    try {
      await steerVoiceServerCall({
        sessionId,
        monitorToken,
        prompt: cleanPrompt,
      });
      toast.success("Live guidance sent");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unable to send live guidance.";
      setSteeringError(message);
      toast.error(message);
      throw err;
    } finally {
      setIsSendingSteeringPrompt(false);
    }
  }, [status]);

  useEffect(() => {
    return () => {
      cleanupTimer();
      cleanupQueuePolling();
      stopLiveAudio();
    };
  }, [cleanupTimer, cleanupQueuePolling, stopLiveAudio]);

  return {
    status,
    recipient,
    presetName,
    durationSecs,
    isMuted,
    errorMessage,
    audioLevels,
    liveAudioAvailable,
    isListeningLive,
    liveAudioError,
    isSendingSteeringPrompt,
    steeringError,
    startCall,
    endCall,
    toggleMute,
    toggleLiveAudio,
    stopLiveAudio,
    steerConversation,
  };
}
