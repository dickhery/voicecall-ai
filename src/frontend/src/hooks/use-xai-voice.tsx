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
import { useInitiateCall, useUpdateCallStatus } from "@/hooks/use-backend";
import { endVoiceServerCall, startVoiceServerCall } from "@/lib/voice-server";
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

const WAVEFORM_BARS = 20;

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

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const activeCallIdRef = useRef<bigint | null>(null);
  const activeCallSidRef = useRef<string | null>(null);

  const initiateCall = useInitiateCall();
  const updateCallStatus = useUpdateCallStatus();
  const { setActiveCall, clearCall } = useCallStore();

  const cleanupTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setAudioLevels(Array(WAVEFORM_BARS).fill(0));
  }, []);

  const resetAfterDelay = useCallback(() => {
    setTimeout(() => {
      setStatus("idle");
      setDurationSecs(0);
      setRecipient("");
      setPresetName("");
      setErrorMessage(null);
      setIsMuted(false);
    }, 3000);
  }, []);

  const startDurationTimer = useCallback(() => {
    startTimeRef.current = Date.now();
    setDurationSecs(0);
    timerRef.current = setInterval(() => {
      setDurationSecs(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
  }, []);

  const startCall = useCallback(
    async (preset: CallPreset, recipientPhone: string) => {
      setStatus("initiating");
      setRecipient(recipientPhone);
      setPresetName(preset.name);
      setErrorMessage(null);
      activeCallIdRef.current = null;
      activeCallSidRef.current = null;

      try {
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

        setStatus("connecting");
        const serverCall = await startVoiceServerCall({
          recipientPhone,
          preset,
          callId,
        });

        activeCallSidRef.current = serverCall.callSid;
        setStatus("in_call");
        startDurationTimer();
        toast.success("Call placed", {
          description: `Twilio SID ${serverCall.callSid}`,
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
        clearCall();
      }
    },
    [
      initiateCall,
      setActiveCall,
      startDurationTimer,
      updateCallStatus,
      cleanupTimer,
      clearCall,
    ],
  );

  const endCall = useCallback(() => {
    setStatus("completed");
    cleanupTimer();

    const callSid = activeCallSidRef.current;
    if (callSid) {
      endVoiceServerCall(callSid).catch((err) => {
        const message = err instanceof Error ? err.message : "Unknown error";
        toast.error(`Unable to end Twilio call: ${message}`);
      });
    }

    if (activeCallIdRef.current !== null) {
      updateCallStatus.mutate({
        callId: activeCallIdRef.current,
        status: CallStatus.completed,
        transcript: null,
      });
    }

    activeCallIdRef.current = null;
    activeCallSidRef.current = null;
    clearCall();
    resetAfterDelay();
  }, [cleanupTimer, updateCallStatus, clearCall, resetAfterDelay]);

  const toggleMute = useCallback(() => {
    setIsMuted((value) => !value);
    toast.info("Use the phone keypad or handset mute for live call audio.");
  }, []);

  useEffect(() => {
    return () => cleanupTimer();
  }, [cleanupTimer]);

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
