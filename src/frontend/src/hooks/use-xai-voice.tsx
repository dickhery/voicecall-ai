/**
 * useXaiVoice — full lifecycle hook for xAI Voice WebSocket calls.
 *
 * Flow:
 * 1. Call startCall(preset, recipient) → initiateCall backend → getEphemeralToken
 * 2. Connect WebSocket to wss://api.x.ai/v1/realtime?model=grok-voice-think-fast-1.0
 * 3. On ws open → send session.update with full preset config (server_vad mode)
 * 4. Request getUserMedia mic → encode PCM → send input_audio_buffer.append every 100ms
 * 5. Handle response.audio.delta → decode base64 PCM → play via Web Audio API
 * 6. Track: connecting | in_call | completed | error states + duration timer + mute
 */

import { AudioFormat, CallStatus, SampleRate } from "@/backend";
import {
  useGetEphemeralToken,
  useInitiateCall,
  useUpdateCallStatus,
} from "@/hooks/use-backend";
import { useCallStore } from "@/stores/call-store";
import type { CallPreset } from "@/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export type XaiCallStatus =
  | "idle"
  | "initiating"
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
}

export interface XaiVoiceControls {
  startCall: (preset: CallPreset, recipient: string) => Promise<void>;
  endCall: () => void;
  toggleMute: () => void;
}

const XAI_WS_URL = "wss://api.x.ai/v1/realtime?model=grok-voice-think-fast-1.0";
const AUDIO_CHUNK_MS = 100;
const WAVEFORM_BARS = 20;

function sampleRateToHz(sr: SampleRate): number {
  switch (sr) {
    case SampleRate.hz8000:
      return 8000;
    case SampleRate.hz16000:
      return 16000;
    case SampleRate.hz22050:
      return 22050;
    case SampleRate.hz24000:
      return 24000;
    case SampleRate.hz32000:
      return 32000;
    case SampleRate.hz44100:
      return 44100;
    case SampleRate.hz48000:
      return 48000;
    default:
      return 16000;
  }
}

function audioFormatToString(af: AudioFormat): string {
  switch (af) {
    case AudioFormat.pcmu:
      return "audio/pcmu";
    case AudioFormat.pcma:
      return "audio/pcma";
    default:
      return "audio/pcm";
  }
}

/** Encode raw Float32 samples → 16-bit PCM little-endian → base64 */
function float32ToBase64Pcm16(float32: Float32Array): string {
  const pcm = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(pcm.buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** Decode base64 PCM16 → Float32Array for Web Audio */
function base64Pcm16ToFloat32(b64: string): Float32Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const pcm = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    float32[i] = pcm[i] / (pcm[i] < 0 ? 0x8000 : 0x7fff);
  }
  return float32;
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

  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const isMutedRef = useRef(false);
  const presetRef = useRef<CallPreset | null>(null);
  // Audio playback queue
  const playbackCtxRef = useRef<AudioContext | null>(null);
  const nextPlayTimeRef = useRef<number>(0);

  const initiateCall = useInitiateCall();
  const getEphemeralToken = useGetEphemeralToken();
  const updateCallStatus = useUpdateCallStatus();
  const { setActiveCall, clearCall } = useCallStore();
  const activeCallIdRef = useRef<bigint | null>(null);
  const transcriptRef = useRef<string>("");

  // Cleanup everything
  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    if (playbackCtxRef.current) {
      playbackCtxRef.current.close().catch(() => {});
      playbackCtxRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setAudioLevels(Array(WAVEFORM_BARS).fill(0));
  }, []);

  // Play PCM audio chunks through Web Audio API
  const playPcmChunk = useCallback((b64: string, sampleRate: number) => {
    if (!playbackCtxRef.current) {
      playbackCtxRef.current = new AudioContext({ sampleRate });
      nextPlayTimeRef.current = playbackCtxRef.current.currentTime;
    }
    const ctx = playbackCtxRef.current;
    const float32 = base64Pcm16ToFloat32(b64);
    const buffer = ctx.createBuffer(1, float32.length, sampleRate);
    buffer.copyToChannel(float32 as Float32Array<ArrayBuffer>, 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    const startAt = Math.max(ctx.currentTime, nextPlayTimeRef.current);
    source.start(startAt);
    nextPlayTimeRef.current = startAt + buffer.duration;
  }, []);

  // Wire microphone → WebSocket
  const startMicCapture = useCallback(
    async (ws: WebSocket, preset: CallPreset) => {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: sampleRateToHz(preset.sampleRate),
        },
      });
      streamRef.current = stream;

      const ctx = new AudioContext({
        sampleRate: sampleRateToHz(preset.sampleRate),
      });
      audioCtxRef.current = ctx;

      const source = ctx.createMediaStreamSource(stream);
      // ScriptProcessorNode gives us raw PCM buffers every AUDIO_CHUNK_MS
      const bufferSize = Math.round(
        (sampleRateToHz(preset.sampleRate) * AUDIO_CHUNK_MS) / 1000,
      );
      // Nearest power of 2 accepted by ScriptProcessorNode
      const validSizes = [256, 512, 1024, 2048, 4096, 8192, 16384];
      const nearestSize = validSizes.reduce((prev, curr) =>
        Math.abs(curr - bufferSize) < Math.abs(prev - bufferSize) ? curr : prev,
      );
      const processor = ctx.createScriptProcessor(nearestSize, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        const channelData = e.inputBuffer.getChannelData(0);

        // Update waveform visual
        const levels: number[] = [];
        const step = Math.floor(channelData.length / WAVEFORM_BARS);
        for (let i = 0; i < WAVEFORM_BARS; i++) {
          let sum = 0;
          for (let j = 0; j < step; j++) {
            sum += Math.abs(channelData[i * step + j]);
          }
          levels.push(Math.min(1, sum / step / 0.3));
        }
        setAudioLevels(levels);

        if (isMutedRef.current) return;
        const b64 = float32ToBase64Pcm16(Float32Array.from(channelData));
        ws.send(
          JSON.stringify({ type: "input_audio_buffer.append", audio: b64 }),
        );
      };

      source.connect(processor);
      processor.connect(ctx.destination);
    },
    [],
  );

  // Build session.update payload from preset
  const buildSessionUpdate = useCallback((preset: CallPreset) => {
    const formatStr = audioFormatToString(preset.audioFormat);
    // For pcmu (Twilio μ-law 8kHz), no rate field — it is fixed at 8000 Hz by the codec
    // For pcm, include the sample rate
    const isPcmu = formatStr === "audio/pcmu";
    const isPcma = formatStr === "audio/pcma";
    const audioInputFormat =
      isPcmu || isPcma
        ? { type: formatStr }
        : { type: formatStr, rate: sampleRateToHz(preset.sampleRate) };
    const audioOutputFormat =
      isPcmu || isPcma
        ? { type: formatStr }
        : { type: formatStr, rate: sampleRateToHz(preset.sampleRate) };

    return {
      type: "session.update",
      session: {
        modalities: ["text", "audio"],
        instructions: preset.systemPrompt,
        voice: preset.voice,
        input_audio_format: audioInputFormat,
        output_audio_format: audioOutputFormat,
        input_audio_transcription: { model: "whisper-1" },
        turn_detection: {
          type: "server_vad",
          threshold: preset.turnDetection.threshold,
          prefix_padding_ms: Number(preset.turnDetection.prefixPaddingMs),
          silence_duration_ms: Number(preset.turnDetection.silenceDurationMs),
        },
        tools: [
          ...(preset.toolsEnabled.webSearch
            ? [
                {
                  type: "web_search",
                },
              ]
            : []),
        ],
        tool_choice: "auto",
        temperature: 0.8,
        max_response_output_tokens: "inf",
      },
    };
  }, []);

  const startCall = useCallback(
    async (preset: CallPreset, recipientPhone: string) => {
      setStatus("initiating");
      setRecipient(recipientPhone);
      setPresetName(preset.name);
      setErrorMessage(null);
      presetRef.current = preset;

      try {
        // 1. Initiate call via backend (Twilio)
        const callResult = await initiateCall.mutateAsync({
          recipientPhone,
          presetId: preset.id,
        });
        if (callResult.__kind__ === "err") {
          throw new Error(callResult.err);
        }
        const { callId } = callResult.ok;
        activeCallIdRef.current = callId;
        setActiveCall(callId, recipientPhone, preset.id);

        // 2. Get ephemeral token for xAI
        setStatus("connecting");
        const tokenResult = await getEphemeralToken.mutateAsync(preset.id);
        if (tokenResult.__kind__ === "err") {
          throw new Error(tokenResult.err);
        }
        const { token, websocketUrl } = tokenResult.ok;
        const wsUrl = websocketUrl || XAI_WS_URL;

        // 3. Open WebSocket — xAI browser auth uses subprotocol: xai-client-secret.<token>
        const ws = new WebSocket(wsUrl, [`xai-client-secret.${token}`]);
        wsRef.current = ws;

        ws.onopen = async () => {
          setStatus("in_call");
          // Send session config
          ws.send(JSON.stringify(buildSessionUpdate(preset)));
          // Start duration timer
          startTimeRef.current = Date.now();
          timerRef.current = setInterval(() => {
            setDurationSecs(
              Math.floor((Date.now() - startTimeRef.current) / 1000),
            );
          }, 1000);
          // Start mic
          try {
            await startMicCapture(ws, preset);
          } catch (_micErr) {
            toast.error(
              "Microphone access denied — call audio will be AI-only",
            );
          }
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data as string) as Record<
              string,
              unknown
            >;
            handleWsMessage(msg, preset);
          } catch {
            // ignore parse errors
          }
        };

        ws.onerror = () => {
          setStatus("error");
          setErrorMessage("WebSocket connection error");
          cleanup();
          clearCall();
        };

        ws.onclose = (e) => {
          if (wsRef.current !== null) {
            setStatus(e.wasClean ? "completed" : "error");
            if (!e.wasClean)
              setErrorMessage(`Connection closed unexpectedly (${e.code})`);
          }
          cleanup();
          clearCall();
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        setStatus("error");
        setErrorMessage(message);
        toast.error(`Call failed: ${message}`);
        cleanup();
        clearCall();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      initiateCall,
      getEphemeralToken,
      setActiveCall,
      clearCall,
      buildSessionUpdate,
      startMicCapture,
      cleanup,
    ],
  );

  // Handle incoming WebSocket messages
  function handleWsMessage(msg: Record<string, unknown>, preset: CallPreset) {
    const type = msg.type as string;
    switch (type) {
      case "session.created":
        // Session ready — nothing extra needed, mic capture already started
        break;
      case "response.output_audio.delta": {
        const delta = msg.delta as string | undefined;
        if (delta) {
          playPcmChunk(delta, sampleRateToHz(preset.sampleRate));
        }
        break;
      }
      case "conversation.item.created": {
        const item = msg.item as
          | { role?: string; content?: Array<{ text?: string }> }
          | undefined;
        if (item?.content) {
          const text = item.content.map((c) => c.text ?? "").join("");
          if (text)
            transcriptRef.current += `${item.role === "assistant" ? "AI: " : "User: "}${text}\n`;
        }
        break;
      }
      case "error": {
        const errObj = msg.error as { message?: string } | undefined;
        toast.error(`xAI error: ${errObj?.message ?? "unknown"}`);
        break;
      }
      default:
        break;
    }
  }

  const endCall = useCallback(() => {
    setStatus("completed");
    if (activeCallIdRef.current !== null) {
      updateCallStatus.mutate({
        callId: activeCallIdRef.current,
        status: CallStatus.completed,
        transcript: transcriptRef.current || null,
      });
      activeCallIdRef.current = null;
      transcriptRef.current = "";
    }
    cleanup();
    clearCall();
    setTimeout(() => {
      setStatus("idle");
      setDurationSecs(0);
      setRecipient("");
      setPresetName("");
    }, 3000);
  }, [cleanup, clearCall, updateCallStatus]);

  const toggleMute = useCallback(() => {
    isMutedRef.current = !isMutedRef.current;
    setIsMuted(isMutedRef.current);
    if (streamRef.current) {
      for (const track of streamRef.current.getAudioTracks()) {
        track.enabled = !isMutedRef.current;
      }
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return {
    status,
    recipient,
    presetName,
    durationSecs,
    isMuted,
    errorMessage,
    audioLevels,
    startCall,
    endCall,
    toggleMute,
  };
}
