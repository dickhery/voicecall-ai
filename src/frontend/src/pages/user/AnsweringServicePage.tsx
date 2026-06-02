import {
  AnsweringPresetStatus,
  AudioFormat,
  SampleRate,
  Voice,
} from "@/backend";
import { AppLayout } from "@/components/AppLayout";
import { NaturalPromptBuilder } from "@/components/NaturalPromptBuilder";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { VoiceIdSelector, getVoiceLabel } from "@/components/VoiceIdSelector";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  useCreateAnsweringPreset,
  useDeleteAnsweringPreset,
  useListMyAnsweringLiveSessions,
  useListMyAnsweringPresets,
  useSetAnsweringPresetEnabled,
  useUpdateAnsweringPreset,
} from "@/hooks/use-backend";
import { copyTextToClipboard } from "@/lib/clipboard";
import {
  TURN_TIMING_PROFILES,
  getTurnTimingProfile,
  getTurnTimingProfileId,
  normalizeTurnDetection,
} from "@/lib/natural-phone";
import { getLiveAudioMonitorUrl, getVoiceServerUrl } from "@/lib/voice-server";
import type { AnsweringPreset, AnsweringPresetInput } from "@/types";
import {
  CheckCircle2,
  Copy,
  Headphones,
  Loader2,
  Pencil,
  PhoneCall,
  PhoneOff,
  Plus,
  Radio,
  Trash2,
  Volume2,
  VolumeX,
} from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

const DEFAULT_TURN_DETECTION =
  TURN_TIMING_PROFILES.find((profile) => profile.id === "balanced")
    ?.turnDetection ?? TURN_TIMING_PROFILES[0].turnDetection;

const DEFAULT_TOOLS = {
  webSearch: false,
  xSearch: false,
  functionCalling: false,
};
const MAX_AI_INSTRUCTIONS_CHARS = 8000;
const defaultTimingText = {
  threshold: `Default: ${DEFAULT_TURN_DETECTION.threshold.toFixed(2)}`,
  silenceDuration: `Default: ${Number(DEFAULT_TURN_DETECTION.silenceDurationMs)}ms`,
  prefixPadding: `Default: ${Number(DEFAULT_TURN_DETECTION.prefixPaddingMs)}ms`,
};

const TURN_DETECTION_HELP =
  "Choose how quickly the AI responds after the caller pauses. Use Patient listener if callers often pause mid-sentence.";

const MONITOR_SAMPLE_RATE = 8000;
const MONITOR_JITTER_SECONDS = 0.12;

function validateE164(phone: string): boolean {
  return /^\+[1-9]\d{1,14}$/.test(phone.replace(/\s/g, ""));
}

function generateWebhookSecret(): string {
  const bytes = new Uint8Array(32);
  window.crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return window
    .btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function parseNumberInputMs(value: string, fallback: bigint): bigint {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return BigInt(Math.max(0, Math.trunc(parsed)));
}

function cloneTurnDetection(
  turnDetection: AnsweringPresetInput["turnDetection"] = DEFAULT_TURN_DETECTION,
): AnsweringPresetInput["turnDetection"] {
  return normalizeTurnDetection(turnDetection);
}

function answeringPresetToInput(preset: AnsweringPreset): AnsweringPresetInput {
  return {
    name: preset.name,
    phoneNumber: preset.phoneNumber,
    systemPrompt: preset.systemPrompt,
    voice: preset.voice,
    voiceId: preset.voiceId ?? "",
    turnDetection: cloneTurnDetection(preset.turnDetection),
    audioFormat: preset.audioFormat,
    sampleRate: preset.sampleRate,
    toolsEnabled: { ...preset.toolsEnabled },
    captureOptions: { ...preset.captureOptions },
    enabled: preset.enabled,
    webhookSecret: preset.webhookSecret,
  };
}

function normalizeAnsweringPresetInput(
  input: AnsweringPresetInput,
): AnsweringPresetInput {
  return {
    ...input,
    name: input.name.trim(),
    phoneNumber: input.phoneNumber.replace(/\s/g, ""),
    systemPrompt: input.systemPrompt.trim(),
    audioFormat: AudioFormat.pcmu,
    sampleRate: SampleRate.hz8000,
    toolsEnabled: {
      webSearch: input.toolsEnabled.webSearch,
      xSearch: input.toolsEnabled.xSearch,
      functionCalling: false,
    },
    turnDetection: cloneTurnDetection(input.turnDetection),
    captureOptions: { ...input.captureOptions },
  };
}

function buildDefaultPreset(): AnsweringPresetInput {
  return {
    name: "",
    phoneNumber: "",
    systemPrompt: "",
    voice: Voice.eve,
    voiceId: "",
    turnDetection: cloneTurnDetection(),
    audioFormat: AudioFormat.pcmu,
    sampleRate: SampleRate.hz8000,
    toolsEnabled: { ...DEFAULT_TOOLS },
    captureOptions: {
      saveTranscript: false,
      recordAudio: false,
      consentConfirmed: false,
    },
    enabled: true,
    webhookSecret: generateWebhookSecret(),
  };
}

function formatDate(ns?: bigint): string {
  if (!ns) return "Never";
  return new Date(Number(ns / 1_000_000n)).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatMinutes(seconds: bigint | number): string {
  return `${Math.floor(Number(seconds) / 60)} min`;
}

function webhookUrl(
  baseUrl: string,
  preset: Pick<AnsweringPreset, "webhookSecret">,
) {
  return baseUrl ? `${baseUrl}/answering/incoming/${preset.webhookSecret}` : "";
}

function decodeBase64Payload(payload: string): Uint8Array {
  const binary = window.atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
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

function TurnDetectionFields({
  value,
  onChange,
  dataOcidPrefix,
}: {
  value: AnsweringPresetInput["turnDetection"];
  onChange: (next: AnsweringPresetInput["turnDetection"]) => void;
  dataOcidPrefix: string;
}) {
  const silenceMs = value.silenceDurationMs ?? 500n;
  const prefixMs = value.prefixPaddingMs ?? 200n;
  const timingProfileId = getTurnTimingProfileId({
    ...value,
    serverVad: true,
  });

  function applyTimingProfile(profileId: string) {
    const profile = getTurnTimingProfile(profileId);
    if (!profile) return;
    onChange(cloneTurnDetection(profile.turnDetection));
  }

  function normalizeTimingValues() {
    onChange(normalizeTurnDetection({ ...value, serverVad: true }));
  }

  return (
    <div className="space-y-4 rounded-md border border-border bg-muted/20 p-4">
      <div className="space-y-3">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-foreground">
            Conversation Timing
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {TURN_DETECTION_HELP}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">
            Timing Profile
          </Label>
          <Select value={timingProfileId} onValueChange={applyTimingProfile}>
            <SelectTrigger
              className="w-full"
              data-ocid={`${dataOcidPrefix}.profile.select`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TURN_TIMING_PROFILES.map((profile) => (
                <SelectItem key={profile.id} value={profile.id}>
                  {profile.label}
                </SelectItem>
              ))}
              <SelectItem value="custom" disabled>
                Custom
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-start justify-between gap-4 rounded-md border border-border bg-background/60 p-3">
          <div className="space-y-0.5">
            <Label className="text-xs text-foreground">
              Automatic phone turn detection
            </Label>
            <p className="text-[10px] leading-tight text-muted-foreground">
              Required for live phone calls through the xAI realtime bridge.
            </p>
          </div>
          <Switch
            checked
            disabled
            data-ocid={`${dataOcidPrefix}.server_vad.switch`}
            className="shrink-0"
          />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">
            Speech Sensitivity
          </Label>
          <span className="font-mono text-xs tabular-nums text-primary">
            {(value.threshold ?? 0.5).toFixed(2)}
          </span>
        </div>
        <Slider
          min={0}
          max={1}
          step={0.01}
          value={[value.threshold ?? 0.5]}
          onValueChange={([threshold]) => onChange({ ...value, threshold })}
          data-ocid={`${dataOcidPrefix}.threshold.slider`}
          className="py-1"
        />
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          Lower values make the AI more sensitive to quieter speech. Raise it if
          background noise keeps the AI from responding.{" "}
          {defaultTimingText.threshold}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">
            Pause Before Reply (ms)
          </Label>
          <Input
            type="number"
            min={0}
            max={5000}
            step={50}
            value={Number(silenceMs)}
            onChange={(event) =>
              onChange({
                ...value,
                silenceDurationMs: parseNumberInputMs(
                  event.target.value,
                  silenceMs,
                ),
              })
            }
            onBlur={normalizeTimingValues}
            data-ocid={`${dataOcidPrefix}.silence_duration.input`}
            className="font-mono text-sm"
          />
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            How long the caller should be quiet before the AI starts answering.
            Increase this if it cuts people off; decrease it if it feels slow.{" "}
            {defaultTimingText.silenceDuration}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">
            Speech Start Buffer (ms)
          </Label>
          <Input
            type="number"
            min={0}
            max={2000}
            step={50}
            value={Number(prefixMs)}
            onChange={(event) =>
              onChange({
                ...value,
                prefixPaddingMs: parseNumberInputMs(
                  event.target.value,
                  prefixMs,
                ),
              })
            }
            onBlur={normalizeTimingValues}
            data-ocid={`${dataOcidPrefix}.prefix_padding.input`}
            className="font-mono text-sm"
          />
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            Keeps a small amount of audio from just before speech starts so
            first words do not get clipped. {defaultTimingText.prefixPadding}
          </p>
        </div>
      </div>
    </div>
  );
}

function LiveAudioButton({
  sessionId,
  monitorToken,
}: {
  sessionId: string;
  monitorToken: string;
}) {
  const [listening, setListening] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const inputNodeRef = useRef<AudioNode | null>(null);
  const nextPlaybackRef = useRef(0);

  const stop = () => {
    wsRef.current?.close();
    wsRef.current = null;
    if (audioContextRef.current?.state !== "closed") {
      void audioContextRef.current?.close();
    }
    audioContextRef.current = null;
    inputNodeRef.current = null;
    nextPlaybackRef.current = 0;
    setListening(false);
  };

  const playPayload = (payload: string) => {
    const audioContext = audioContextRef.current;
    const inputNode = inputNodeRef.current;
    if (!audioContext || !inputNode) return;
    const bytes = decodeBase64Payload(payload);
    const buffer = audioContext.createBuffer(
      1,
      bytes.length,
      MONITOR_SAMPLE_RATE,
    );
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < bytes.length; i += 1) {
      samples[i] = decodeMuLawSample(bytes[i]);
    }
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(inputNode);
    const startAt =
      nextPlaybackRef.current > audioContext.currentTime
        ? nextPlaybackRef.current
        : audioContext.currentTime + MONITOR_JITTER_SECONDS;
    source.start(startAt);
    nextPlaybackRef.current = startAt + buffer.duration;
  };

  const start = async () => {
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
    const lowpass = audioContext.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = 3600;
    const gain = audioContext.createGain();
    gain.gain.value = 0.95;
    highpass.connect(lowpass);
    lowpass.connect(gain);
    gain.connect(audioContext.destination);
    audioContextRef.current = audioContext;
    inputNodeRef.current = highpass;
    nextPlaybackRef.current = audioContext.currentTime + MONITOR_JITTER_SECONDS;
    await audioContext.resume();

    const ws = new WebSocket(
      await getLiveAudioMonitorUrl({ sessionId, monitorToken }),
    );
    wsRef.current = ws;
    ws.onopen = () => setListening(true);
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data));
        if (message.type === "audio" && message.payload) {
          playPayload(message.payload);
        }
        if (message.type === "ended") stop();
        if (message.type === "error") throw new Error(message.error);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Live audio failed",
        );
      }
    };
    ws.onerror = () => toast.error("Live audio connection failed");
    ws.onclose = () => setListening(false);
  };

  useEffect(() => {
    return () => {
      wsRef.current?.close();
      if (audioContextRef.current?.state !== "closed") {
        void audioContextRef.current?.close();
      }
    };
  }, []);

  return (
    <Button
      type="button"
      variant={listening ? "secondary" : "outline"}
      size="sm"
      className="gap-2"
      onClick={() => (listening ? stop() : void start())}
    >
      {listening ? (
        <VolumeX className="h-4 w-4" />
      ) : (
        <Volume2 className="h-4 w-4" />
      )}
      {listening ? "Stop Audio" : "Listen Live"}
    </Button>
  );
}

function AnsweringPresetCard({
  preset,
  baseUrl,
}: {
  preset: AnsweringPreset;
  baseUrl: string;
}) {
  const setEnabled = useSetAnsweringPresetEnabled();
  const deletePreset = useDeleteAnsweringPreset();
  const updatePreset = useUpdateAnsweringPreset();
  const [isEditingPreset, setIsEditingPreset] = useState(false);
  const [draftPreset, setDraftPreset] = useState<AnsweringPresetInput>(() =>
    answeringPresetToInput(preset),
  );
  const isVerified =
    preset.verificationStatus === AnsweringPresetStatus.verified;
  const url = webhookUrl(baseUrl, preset);
  const draftCaptureRequested =
    draftPreset.captureOptions.saveTranscript ||
    draftPreset.captureOptions.recordAudio;

  useEffect(() => {
    if (!isEditingPreset) {
      setDraftPreset(answeringPresetToInput(preset));
    }
  }, [isEditingPreset, preset]);

  const openEditor = () => {
    setDraftPreset(answeringPresetToInput(preset));
    setIsEditingPreset(true);
  };

  const toggleEnabled = async (enabled: boolean) => {
    const result = await setEnabled.mutateAsync({ id: preset.id, enabled });
    if (result.__kind__ === "err") {
      toast.error(result.err);
      return;
    }
    toast.success(enabled ? "Answering service on" : "Answering service off");
  };

  const remove = async () => {
    await deletePreset.mutateAsync(preset.id);
    toast.success("Answering preset deleted");
  };

  const savePreset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanInput = normalizeAnsweringPresetInput(draftPreset);
    if (!cleanInput.name) {
      toast.error("Preset name is required");
      return;
    }
    if (!cleanInput.systemPrompt) {
      toast.error("AI answering instructions are required");
      return;
    }
    if (cleanInput.systemPrompt.length > MAX_AI_INSTRUCTIONS_CHARS) {
      toast.error("AI instructions must be 8000 characters or fewer");
      return;
    }
    if (!validateE164(cleanInput.phoneNumber)) {
      toast.error("Enter the Twilio number in E.164 format");
      return;
    }
    if (
      (cleanInput.captureOptions.saveTranscript ||
        cleanInput.captureOptions.recordAudio) &&
      !cleanInput.captureOptions.consentConfirmed
    ) {
      toast.error("Confirm caller consent before saving call artifacts");
      return;
    }
    const result = await updatePreset.mutateAsync({
      id: preset.id,
      input: cleanInput,
    });
    if (result.__kind__ === "err") {
      toast.error(result.err);
      return;
    }
    toast.success("Answering preset updated");
    setIsEditingPreset(false);
  };

  return (
    <>
      <Card className="border-border bg-card">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="space-y-1">
              <CardTitle className="text-lg">{preset.name}</CardTitle>
              <CardDescription className="font-mono">
                {preset.phoneNumber}
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant="outline"
                className={
                  isVerified
                    ? "border-green-500/40 text-green-400"
                    : "border-yellow-500/40 text-yellow-400"
                }
              >
                {isVerified ? "Verified" : "Pending"}
              </Badge>
              <div className="flex items-center gap-2 rounded-md border border-border px-2 py-1">
                <Switch
                  checked={preset.enabled}
                  disabled={!isVerified || setEnabled.isPending}
                  onCheckedChange={(enabled) => void toggleEnabled(enabled)}
                />
                <span className="text-xs text-muted-foreground">
                  {preset.enabled ? "On" : "Off"}
                </span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={openEditor}
                aria-label="Edit answering preset"
                data-ocid={`answering.preset.edit.${preset.id.toString()}`}
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => void remove()}
                disabled={deletePreset.isPending}
                aria-label="Delete answering preset"
              >
                {deletePreset.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-md border border-border p-3">
              <p className="text-xs font-medium uppercase text-muted-foreground">
                Voice
              </p>
              <p className="mt-1 text-sm font-semibold">
                {getVoiceLabel(preset.voice, preset.voiceId)}
              </p>
            </div>
            <div className="rounded-md border border-border p-3">
              <p className="text-xs font-medium uppercase text-muted-foreground">
                Capture
              </p>
              <p className="mt-1 text-sm">
                {[
                  preset.captureOptions.saveTranscript ? "Transcript" : "",
                  preset.captureOptions.recordAudio ? "Audio" : "",
                ]
                  .filter(Boolean)
                  .join(" + ") || "Off"}
              </p>
            </div>
            <div className="rounded-md border border-border p-3">
              <p className="text-xs font-medium uppercase text-muted-foreground">
                Last Call
              </p>
              <p className="mt-1 text-sm">
                {formatDate(preset.lastIncomingAt)}
              </p>
            </div>
          </div>
          <div className="rounded-md border border-border p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <Label className="text-xs font-semibold uppercase text-muted-foreground">
                AI Instructions
              </Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 px-2 text-xs"
                onClick={openEditor}
                data-ocid={`answering.preset.edit_button.${preset.id.toString()}`}
              >
                <Pencil className="h-3 w-3" />
                Edit
              </Button>
            </div>
            <p className="line-clamp-3 whitespace-pre-line text-sm text-muted-foreground">
              {preset.systemPrompt}
            </p>
          </div>
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase text-muted-foreground">
              Twilio Voice Webhook
            </Label>
            <div className="flex gap-2">
              <Input
                value={url || "Voice server URL is not configured"}
                readOnly
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                disabled={!url}
                onClick={() => {
                  void copyTextToClipboard(url);
                  toast.success("Webhook URL copied");
                }}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            {!isVerified && (
              <p className="text-xs text-muted-foreground">
                Set this URL as the number’s Voice webhook in Twilio, then call
                the number once. The first webhook confirms the number.
              </p>
            )}
          </div>
        </CardContent>
      </Card>
      <Dialog
        open={isEditingPreset}
        onOpenChange={(open) => {
          setIsEditingPreset(open);
          if (!open) setDraftPreset(answeringPresetToInput(preset));
        }}
      >
        <DialogContent
          className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"
          data-ocid={`answering.preset.edit_dialog.${preset.id.toString()}`}
        >
          <DialogHeader>
            <DialogTitle>Edit Answering Preset</DialogTitle>
            <DialogDescription>
              Update the phone routing, voice, capture, and response timing for
              {` ${preset.name}`}.
            </DialogDescription>
          </DialogHeader>

          <form className="space-y-4" onSubmit={savePreset} noValidate>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor={`answering-preset-name-${preset.id}`}>
                  Preset Name
                </Label>
                <Input
                  id={`answering-preset-name-${preset.id}`}
                  value={draftPreset.name}
                  onChange={(event) =>
                    setDraftPreset({
                      ...draftPreset,
                      name: event.target.value,
                    })
                  }
                  data-ocid={`answering.preset.name_input.${preset.id.toString()}`}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`answering-preset-phone-${preset.id}`}>
                  Twilio Number
                </Label>
                <Input
                  id={`answering-preset-phone-${preset.id}`}
                  value={draftPreset.phoneNumber}
                  onChange={(event) =>
                    setDraftPreset({
                      ...draftPreset,
                      phoneNumber: event.target.value.replace(/\s/g, ""),
                    })
                  }
                  placeholder="+15551234567"
                  data-ocid={`answering.preset.phone_input.${preset.id.toString()}`}
                  required
                />
                {draftPreset.phoneNumber !== preset.phoneNumber && (
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    Changing the number will pause this preset until the new
                    Twilio webhook is verified.
                  </p>
                )}
              </div>
            </div>

            <NaturalPromptBuilder
              direction="inbound"
              onPromptChange={(systemPrompt) =>
                setDraftPreset({
                  ...draftPreset,
                  systemPrompt,
                })
              }
              dataOcidPrefix={`answering.preset.${preset.id.toString()}.natural_prompt`}
            />

            <div className="space-y-2">
              <Label htmlFor={`answering-preset-instructions-${preset.id}`}>
                AI Instructions
              </Label>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Type a custom prompt here, or open the builder above to generate
                a starting point and then edit it. Include the exact name or
                role the AI should use, plus the goal, facts, boundaries, and
                expected questions.
              </p>
              <Textarea
                id={`answering-preset-instructions-${preset.id}`}
                value={draftPreset.systemPrompt}
                onChange={(event) =>
                  setDraftPreset({
                    ...draftPreset,
                    systemPrompt: event.target.value,
                  })
                }
                rows={7}
                maxLength={MAX_AI_INSTRUCTIONS_CHARS}
                data-ocid={`answering.preset.instructions_textarea.${preset.id.toString()}`}
                className="resize-none font-mono text-xs leading-relaxed"
                required
              />
              <div className="flex justify-end">
                <span className="font-mono text-[11px] text-muted-foreground">
                  {draftPreset.systemPrompt.trim().length}/
                  {MAX_AI_INSTRUCTIONS_CHARS}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Voice</Label>
              <VoiceIdSelector
                value={{
                  voice: draftPreset.voice,
                  voiceId: draftPreset.voiceId,
                }}
                onChange={(next) =>
                  setDraftPreset({
                    ...draftPreset,
                    voice: next.voice,
                    voiceId: next.voiceId ?? "",
                  })
                }
                dataOcidPrefix={`answering.preset.${preset.id.toString()}`}
              />
            </div>

            <TurnDetectionFields
              value={draftPreset.turnDetection}
              onChange={(turnDetection) =>
                setDraftPreset({ ...draftPreset, turnDetection })
              }
              dataOcidPrefix={`answering.preset.${preset.id.toString()}.turn_detection`}
            />

            <div className="grid gap-3 md:grid-cols-2">
              <div className="flex items-center gap-3 rounded-md border border-border p-3">
                <Checkbox
                  id={`answering-preset-save-transcript-${preset.id}`}
                  checked={draftPreset.captureOptions.saveTranscript}
                  onCheckedChange={(checked) =>
                    setDraftPreset({
                      ...draftPreset,
                      captureOptions: {
                        ...draftPreset.captureOptions,
                        saveTranscript: checked === true,
                      },
                    })
                  }
                />
                <Label
                  htmlFor={`answering-preset-save-transcript-${preset.id}`}
                  className="text-sm"
                >
                  Save transcripts
                </Label>
              </div>
              <div className="flex items-center gap-3 rounded-md border border-border p-3">
                <Checkbox
                  id={`answering-preset-record-audio-${preset.id}`}
                  checked={draftPreset.captureOptions.recordAudio}
                  onCheckedChange={(checked) =>
                    setDraftPreset({
                      ...draftPreset,
                      captureOptions: {
                        ...draftPreset.captureOptions,
                        recordAudio: checked === true,
                      },
                    })
                  }
                />
                <Label
                  htmlFor={`answering-preset-record-audio-${preset.id}`}
                  className="text-sm"
                >
                  Save audio recordings
                </Label>
              </div>
            </div>

            {draftCaptureRequested && (
              <div className="flex items-start gap-3 rounded-md border border-border bg-muted/20 p-3">
                <Checkbox
                  id={`answering-preset-consent-${preset.id}`}
                  checked={draftPreset.captureOptions.consentConfirmed}
                  onCheckedChange={(checked) =>
                    setDraftPreset({
                      ...draftPreset,
                      captureOptions: {
                        ...draftPreset.captureOptions,
                        consentConfirmed: checked === true,
                      },
                    })
                  }
                />
                <Label
                  htmlFor={`answering-preset-consent-${preset.id}`}
                  className="text-sm leading-relaxed text-muted-foreground"
                >
                  I confirm this preset will only save recordings or transcripts
                  where caller consent requirements are met.
                </Label>
              </div>
            )}

            <div className="flex items-center justify-between rounded-md border border-border p-3">
              <Label
                htmlFor={`answering-preset-enabled-${preset.id}`}
                className="text-sm"
              >
                Answer incoming calls
              </Label>
              <Switch
                id={`answering-preset-enabled-${preset.id}`}
                checked={draftPreset.enabled}
                onCheckedChange={(enabled) =>
                  setDraftPreset({ ...draftPreset, enabled })
                }
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setIsEditingPreset(false);
                  setDraftPreset(answeringPresetToInput(preset));
                }}
                data-ocid={`answering.preset.edit_cancel_button.${preset.id.toString()}`}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={updatePreset.isPending}
                data-ocid={`answering.preset.edit_save_button.${preset.id.toString()}`}
                className="gap-2"
              >
                {updatePreset.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Pencil className="h-4 w-4" />
                )}
                Update Preset
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function AnsweringServicePage() {
  const [baseUrl, setBaseUrl] = useState("");
  const [input, setInput] = useState<AnsweringPresetInput>(() =>
    buildDefaultPreset(),
  );
  const presets = useListMyAnsweringPresets();
  const liveSessions = useListMyAnsweringLiveSessions();
  const createPreset = useCreateAnsweringPreset();
  const pendingPreset = presets.data?.find(
    (preset) =>
      preset.verificationStatus === AnsweringPresetStatus.pendingVerification,
  );
  const captureRequested =
    input.captureOptions.saveTranscript || input.captureOptions.recordAudio;

  useEffect(() => {
    getVoiceServerUrl()
      .then(setBaseUrl)
      .catch(() => setBaseUrl(""));
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanInput = normalizeAnsweringPresetInput(input);
    if (!cleanInput.name) {
      toast.error("Preset name is required");
      return;
    }
    if (!cleanInput.systemPrompt) {
      toast.error("AI answering instructions are required");
      return;
    }
    if (cleanInput.systemPrompt.length > MAX_AI_INSTRUCTIONS_CHARS) {
      toast.error("AI instructions must be 8000 characters or fewer");
      return;
    }
    if (!validateE164(cleanInput.phoneNumber)) {
      toast.error("Enter the Twilio number in E.164 format");
      return;
    }
    if (
      (cleanInput.captureOptions.saveTranscript ||
        cleanInput.captureOptions.recordAudio) &&
      !cleanInput.captureOptions.consentConfirmed
    ) {
      toast.error("Confirm caller consent before saving call artifacts");
      return;
    }
    const result = await createPreset.mutateAsync(cleanInput);
    if (result.__kind__ === "err") {
      toast.error(result.err);
      return;
    }
    toast.success("Answering preset created");
    setInput(buildDefaultPreset());
  };

  return (
    <ProtectedRoute>
      <AppLayout>
        <div className="space-y-6" data-ocid="answering.page">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="font-display text-3xl font-bold tracking-tight">
                AI Answering
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Connect a Twilio number to a Grok voice preset for incoming
                calls.
              </p>
            </div>
            <a
              href="https://console.twilio.com/us1/develop/phone-numbers/manage/incoming"
              target="_blank"
              rel="noreferrer"
            >
              <Button variant="outline" className="gap-2">
                <PhoneCall className="h-4 w-4" />
                Open Twilio
              </Button>
            </a>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Plus className="h-5 w-5 text-primary" />
                  New Answering Preset
                </CardTitle>
                <CardDescription>
                  Create one preset per Twilio phone number.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {pendingPreset ? (
                  <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-200">
                    Verify {pendingPreset.phoneNumber} before adding another
                    answering preset.
                  </div>
                ) : (
                  <form className="space-y-4" onSubmit={submit} noValidate>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Preset Name</Label>
                        <Input
                          value={input.name}
                          onChange={(event) =>
                            setInput({ ...input, name: event.target.value })
                          }
                          placeholder="After-hours support"
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Twilio Number</Label>
                        <Input
                          value={input.phoneNumber}
                          onChange={(event) =>
                            setInput({
                              ...input,
                              phoneNumber: event.target.value.replace(
                                /\s/g,
                                "",
                              ),
                            })
                          }
                          placeholder="+15551234567"
                          required
                        />
                      </div>
                    </div>
                    <NaturalPromptBuilder
                      direction="inbound"
                      onPromptChange={(systemPrompt) =>
                        setInput({
                          ...input,
                          systemPrompt,
                        })
                      }
                      dataOcidPrefix="answering.natural_prompt"
                    />
                    <div className="space-y-2">
                      <Label>AI Instructions</Label>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        Type a custom prompt here, or open the builder above to
                        generate a starting point and then edit it. Include the
                        exact name or role the AI should use, plus the goal,
                        facts, boundaries, and expected questions.
                      </p>
                      <Textarea
                        value={input.systemPrompt}
                        onChange={(event) =>
                          setInput({
                            ...input,
                            systemPrompt: event.target.value,
                          })
                        }
                        rows={5}
                        maxLength={MAX_AI_INSTRUCTIONS_CHARS}
                        className="resize-none font-mono text-xs"
                        placeholder="You are Jordan Rivera, the front desk assistant for a small design studio. Ask for the caller's name, reason for calling, and preferred callback time."
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Voice</Label>
                      <VoiceIdSelector
                        value={{ voice: input.voice, voiceId: input.voiceId }}
                        onChange={(next) =>
                          setInput({
                            ...input,
                            voice: next.voice,
                            voiceId: next.voiceId ?? "",
                          })
                        }
                        dataOcidPrefix="answering"
                      />
                    </div>
                    <TurnDetectionFields
                      value={input.turnDetection}
                      onChange={(turnDetection) =>
                        setInput({ ...input, turnDetection })
                      }
                      dataOcidPrefix="answering.turn_detection"
                    />
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="flex items-center gap-3 rounded-md border border-border p-3">
                        <Checkbox
                          id="answering-save-transcript"
                          checked={input.captureOptions.saveTranscript}
                          onCheckedChange={(checked) =>
                            setInput({
                              ...input,
                              captureOptions: {
                                ...input.captureOptions,
                                saveTranscript: checked === true,
                              },
                            })
                          }
                        />
                        <Label
                          htmlFor="answering-save-transcript"
                          className="text-sm"
                        >
                          Save transcripts
                        </Label>
                      </div>
                      <div className="flex items-center gap-3 rounded-md border border-border p-3">
                        <Checkbox
                          id="answering-record-audio"
                          checked={input.captureOptions.recordAudio}
                          onCheckedChange={(checked) =>
                            setInput({
                              ...input,
                              captureOptions: {
                                ...input.captureOptions,
                                recordAudio: checked === true,
                              },
                            })
                          }
                        />
                        <Label
                          htmlFor="answering-record-audio"
                          className="text-sm"
                        >
                          Save audio recordings
                        </Label>
                      </div>
                    </div>
                    {captureRequested && (
                      <div className="flex items-start gap-3 rounded-md border border-border bg-muted/20 p-3">
                        <Checkbox
                          id="answering-consent"
                          checked={input.captureOptions.consentConfirmed}
                          onCheckedChange={(checked) =>
                            setInput({
                              ...input,
                              captureOptions: {
                                ...input.captureOptions,
                                consentConfirmed: checked === true,
                              },
                            })
                          }
                        />
                        <Label
                          htmlFor="answering-consent"
                          className="text-sm leading-relaxed text-muted-foreground"
                        >
                          I confirm this preset will only save recordings or
                          transcripts where caller consent requirements are met.
                        </Label>
                      </div>
                    )}
                    <div className="flex items-center justify-between rounded-md border border-border p-3">
                      <Label htmlFor="answering-enable" className="text-sm">
                        Turn on after verification
                      </Label>
                      <Switch
                        id="answering-enable"
                        checked={input.enabled}
                        onCheckedChange={(enabled) =>
                          setInput({ ...input, enabled })
                        }
                      />
                    </div>
                    <Button
                      type="submit"
                      className="w-full gap-2"
                      disabled={createPreset.isPending}
                    >
                      {createPreset.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Plus className="h-4 w-4" />
                      )}
                      Create Answering Preset
                    </Button>
                  </form>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <CheckCircle2 className="h-5 w-5 text-primary" />
                  Setup
                </CardTitle>
                <CardDescription>
                  Use Twilio’s phone-number Voice webhook.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-sm text-muted-foreground">
                <div className="space-y-2">
                  <p>
                    1. Create a Twilio account and buy a voice-capable number.
                  </p>
                  <p>2. Create an answering preset here using that number.</p>
                  <p>
                    3. Copy the preset webhook URL into Twilio under Voice
                    Configuration, “A call comes in”, Webhook, HTTP POST.
                  </p>
                  <p>
                    4. Call the number once. The app verifies the number when
                    Twilio reaches the webhook.
                  </p>
                </div>
                <div className="rounded-md border border-border bg-muted/20 p-3">
                  The app does not need your Twilio Auth Token for this setup.
                  Turning a preset off rejects new calls before the AI answers.
                </div>
                <a
                  href="https://www.twilio.com/docs/voice/twiml/stream"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex text-primary hover:underline"
                >
                  Twilio Media Streams documentation
                </a>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Radio className="h-5 w-5 text-primary" />
                Live Incoming Calls
              </CardTitle>
              <CardDescription>
                Active calls appear here while Twilio is connected.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {liveSessions.isLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : liveSessions.data?.length ? (
                <div className="space-y-3">
                  {liveSessions.data.map((session) => (
                    <div
                      key={session.sessionId}
                      className="flex flex-col gap-3 rounded-md border border-border p-3 md:flex-row md:items-center md:justify-between"
                    >
                      <div>
                        <p className="font-medium">
                          {session.answeringPresetName}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {session.callerPhone} ·{" "}
                          {formatMinutes(session.allowedSeconds)} reserved
                        </p>
                      </div>
                      <LiveAudioButton
                        sessionId={session.sessionId}
                        monitorToken={session.monitorToken}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-3 rounded-md border border-border p-4 text-sm text-muted-foreground">
                  <Headphones className="h-4 w-4" />
                  No live incoming calls.
                </div>
              )}
            </CardContent>
          </Card>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Answering Presets</h2>
              <Badge variant="outline">
                {presets.data?.length ?? 0} configured
              </Badge>
            </div>
            {presets.isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-36 w-full" />
                <Skeleton className="h-36 w-full" />
              </div>
            ) : presets.data?.length ? (
              <div className="space-y-3">
                {presets.data.map((preset) => (
                  <AnsweringPresetCard
                    key={preset.id.toString()}
                    preset={preset}
                    baseUrl={baseUrl}
                  />
                ))}
              </div>
            ) : (
              <Card>
                <CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
                  <PhoneOff className="h-4 w-4" />
                  No answering presets yet.
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </AppLayout>
    </ProtectedRoute>
  );
}
