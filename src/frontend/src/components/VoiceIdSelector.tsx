import { Voice } from "@/backend";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type XaiVoiceOption, listXaiVoiceLibrary } from "@/lib/voice-server";
import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

export const DEFAULT_XAI_VOICE_OPTIONS: XaiVoiceOption[] = [
  {
    voiceId: "eve",
    name: "Eve",
    description: "Energetic, upbeat",
    type: "built-in",
  },
  {
    voiceId: "ara",
    name: "Ara",
    description: "Warm, friendly",
    type: "built-in",
  },
  {
    voiceId: "rex",
    name: "Rex",
    description: "Confident, clear",
    type: "built-in",
  },
  {
    voiceId: "sal",
    name: "Sal",
    description: "Smooth, balanced",
    type: "built-in",
  },
  {
    voiceId: "leo",
    name: "Leo",
    description: "Authoritative, strong",
    type: "built-in",
  },
];

const LEGACY_VOICE_BY_ID: Record<string, Voice> = {
  eve: Voice.eve,
  ara: Voice.ara,
  rex: Voice.rex,
  sal: Voice.sal,
  leo: Voice.leo,
};

const DEFAULT_VOICE_BY_ID = new Map(
  DEFAULT_XAI_VOICE_OPTIONS.map((voice) => [voice.voiceId, voice]),
);

export function normalizeVoiceId(value?: string | null): string {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function voiceToVoiceId(voice: Voice): string {
  return String(voice).toLowerCase();
}

function mergeVoiceOptions(voices: XaiVoiceOption[]): XaiVoiceOption[] {
  const byId = new Map<string, XaiVoiceOption>();
  for (const voice of DEFAULT_XAI_VOICE_OPTIONS) {
    byId.set(normalizeVoiceId(voice.voiceId), voice);
  }
  for (const voice of voices) {
    const voiceId = normalizeVoiceId(voice.voiceId);
    if (!voiceId) continue;
    byId.set(voiceId, {
      ...voice,
      voiceId: voice.voiceId.trim(),
      name: voice.name || voice.voiceId,
    });
  }
  return Array.from(byId.values());
}

export function getVoiceLabel(voice: Voice, voiceId?: string | null): string {
  const normalized = normalizeVoiceId(voiceId);
  if (normalized) {
    return DEFAULT_VOICE_BY_ID.get(normalized)?.name ?? String(voiceId).trim();
  }
  return DEFAULT_VOICE_BY_ID.get(voiceToVoiceId(voice))?.name ?? String(voice);
}

export function getVoiceInitial(voice: Voice, voiceId?: string | null): string {
  return getVoiceLabel(voice, voiceId).slice(0, 1).toUpperCase() || "?";
}

interface VoiceIdSelectorProps {
  value: {
    voice: Voice;
    voiceId?: string | null;
  };
  onChange: (value: { voice: Voice; voiceId?: string }) => void;
  dataOcidPrefix?: string;
}

export function VoiceIdSelector({
  value,
  onChange,
  dataOcidPrefix = "voice_selector",
}: VoiceIdSelectorProps) {
  const [voices, setVoices] = useState<XaiVoiceOption[]>(
    DEFAULT_XAI_VOICE_OPTIONS,
  );
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let canceled = false;
    setIsLoading(true);
    listXaiVoiceLibrary()
      .then((library) => {
        if (!canceled) setVoices(mergeVoiceOptions(library.voices));
      })
      .catch(() => {
        if (!canceled) setVoices(DEFAULT_XAI_VOICE_OPTIONS);
      })
      .finally(() => {
        if (!canceled) setIsLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, []);

  const activeVoiceId =
    normalizeVoiceId(value.voiceId) || voiceToVoiceId(value.voice);
  const displayedVoices = useMemo(() => mergeVoiceOptions(voices), [voices]);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {displayedVoices.map((voice) => {
          const voiceId = normalizeVoiceId(voice.voiceId);
          const isActive = activeVoiceId === voiceId;
          return (
            <Button
              key={voice.voiceId}
              type="button"
              variant={isActive ? "secondary" : "outline"}
              className="h-auto min-h-20 flex-col items-start gap-1 whitespace-normal p-3 text-left"
              onClick={() => {
                const legacyVoice = LEGACY_VOICE_BY_ID[voiceId];
                onChange({
                  voice: legacyVoice ?? value.voice,
                  voiceId: legacyVoice ? "" : voice.voiceId,
                });
              }}
              data-ocid={`${dataOcidPrefix}.preset_voice.${voiceId}`}
            >
              <span className="text-sm font-semibold leading-tight">
                {voice.name || voice.voiceId}
              </span>
              <span className="text-[10px] leading-tight text-muted-foreground">
                {voice.description || voice.voiceId}
              </span>
            </Button>
          );
        })}
      </div>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Voice ID
          </Label>
          <Input
            value={value.voiceId ?? ""}
            onChange={(event) =>
              onChange({ voice: value.voice, voiceId: event.target.value })
            }
            placeholder="nlbqfwie"
            data-ocid={`${dataOcidPrefix}.custom_voice_id.input`}
          />
        </div>
        {isLoading && (
          <div className="flex h-10 items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading voices
          </div>
        )}
      </div>
    </div>
  );
}
