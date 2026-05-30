import { Voice } from "@/backend";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  type XaiVoiceOption,
  listXaiVoiceLibrary,
  previewXaiVoice,
} from "@/lib/voice-server";
import { ListFilter, Loader2, Search, Volume2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

export const DEFAULT_XAI_VOICE_OPTIONS: XaiVoiceOption[] = [
  {
    voiceId: "eve",
    name: "Eve",
    description: "Default voice, engaging and enthusiastic",
    type: "built-in",
    gender: "Female",
    tone: "Energetic, upbeat",
  },
  {
    voiceId: "ara",
    name: "Ara",
    description: "Balanced and conversational",
    type: "built-in",
    gender: "Female",
    tone: "Warm, friendly",
  },
  {
    voiceId: "rex",
    name: "Rex",
    description: "Professional and articulate, ideal for business",
    type: "built-in",
    gender: "Male",
    tone: "Confident, clear",
  },
  {
    voiceId: "sal",
    name: "Sal",
    description: "Versatile voice suitable for various contexts",
    type: "built-in",
    gender: "Neutral",
    tone: "Smooth, balanced",
  },
  {
    voiceId: "leo",
    name: "Leo",
    description: "Decisive and commanding, suitable for instructional content",
    type: "built-in",
    gender: "Male",
    tone: "Authoritative, strong",
  },
];

type VoiceFilterGroup = "source" | "type" | "tone";

type VoiceFilters = Record<VoiceFilterGroup, string[]>;

interface VoiceFilterOption {
  key: string;
  label: string;
  count: number;
}

const EMPTY_FILTERS: VoiceFilters = {
  source: [],
  type: [],
  tone: [],
};

const FILTER_GROUPS: { key: VoiceFilterGroup; label: string }[] = [
  { key: "type", label: "Type" },
  { key: "tone", label: "Tone" },
  { key: "source", label: "Source" },
];

const FILTER_SORT_ORDER: Record<VoiceFilterGroup, string[]> = {
  source: ["built-in", "custom"],
  type: ["female", "male", "neutral"],
  tone: [
    "energetic",
    "upbeat",
    "warm",
    "friendly",
    "confident",
    "clear",
    "professional",
    "smooth",
    "balanced",
    "authoritative",
    "strong",
    "instructional",
    "conversational",
    "versatile",
  ],
};

const TONE_FILTERS = [
  { key: "energetic", aliases: ["energetic", "engaging", "enthusiastic"] },
  { key: "upbeat", aliases: ["upbeat"] },
  { key: "warm", aliases: ["warm"] },
  { key: "friendly", aliases: ["friendly"] },
  { key: "confident", aliases: ["confident"] },
  { key: "clear", aliases: ["clear", "articulate"] },
  { key: "professional", aliases: ["professional", "business"] },
  { key: "smooth", aliases: ["smooth"] },
  { key: "balanced", aliases: ["balanced"] },
  { key: "authoritative", aliases: ["authoritative", "commanding"] },
  { key: "strong", aliases: ["strong", "decisive"] },
  { key: "instructional", aliases: ["instructional"] },
  { key: "conversational", aliases: ["conversational"] },
  { key: "versatile", aliases: ["versatile"] },
];

const FILTER_LABELS: Record<string, string> = {
  "built-in": "Built-in",
  custom: "Custom",
};

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
    const existing = byId.get(voiceId);
    byId.set(voiceId, {
      ...existing,
      ...voice,
      voiceId: voice.voiceId.trim(),
      name: voice.name || existing?.name || voice.voiceId,
      description: voice.description || existing?.description,
      type: voice.type || existing?.type,
      gender: voice.gender || existing?.gender,
      tone: voice.tone || existing?.tone,
    });
  }
  return Array.from(byId.values());
}

function normalizeFilterKey(value?: string | null): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formatFilterLabel(key: string): string {
  if (FILTER_LABELS[key]) return FILTER_LABELS[key];
  return key
    .split("-")
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function addUnique(values: string[], next?: string | null) {
  const key = normalizeFilterKey(next);
  if (key && !values.includes(key)) values.push(key);
}

function getSourceFilter(voice: XaiVoiceOption): string {
  const source = normalizeFilterKey(voice.type);
  if (source.includes("custom")) return "custom";
  return "built-in";
}

function getTypeFilters(voice: XaiVoiceOption): string[] {
  const values: string[] = [];
  addUnique(values, voice.gender);

  const type = normalizeFilterKey(voice.type);
  if (type === "female" || type === "male" || type === "neutral") {
    addUnique(values, type);
  }

  const searchable = [voice.name, voice.description, voice.tone]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  for (const option of FILTER_SORT_ORDER.type) {
    if (searchable.includes(option)) addUnique(values, option);
  }

  return values;
}

function getToneFilters(voice: XaiVoiceOption): string[] {
  const values: string[] = [];
  const searchable = [voice.name, voice.description, voice.tone, voice.voiceId]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  for (const option of TONE_FILTERS) {
    if (option.aliases.some((alias) => searchable.includes(alias))) {
      addUnique(values, option.key);
    }
  }

  return values;
}

function getVoiceFilterValues(
  voice: XaiVoiceOption,
): Record<VoiceFilterGroup, string[]> {
  return {
    source: [getSourceFilter(voice)],
    type: getTypeFilters(voice),
    tone: getToneFilters(voice),
  };
}

function buildFilterOptions(
  voices: XaiVoiceOption[],
): Record<VoiceFilterGroup, VoiceFilterOption[]> {
  const counts: Record<VoiceFilterGroup, Map<string, number>> = {
    source: new Map(),
    type: new Map(),
    tone: new Map(),
  };

  for (const voice of voices) {
    const values = getVoiceFilterValues(voice);
    for (const group of FILTER_GROUPS) {
      for (const key of new Set(values[group.key])) {
        counts[group.key].set(key, (counts[group.key].get(key) ?? 0) + 1);
      }
    }
  }

  return {
    source: toFilterOptions("source", counts.source),
    type: toFilterOptions("type", counts.type),
    tone: toFilterOptions("tone", counts.tone),
  };
}

function toFilterOptions(
  group: VoiceFilterGroup,
  counts: Map<string, number>,
): VoiceFilterOption[] {
  const sortOrder = FILTER_SORT_ORDER[group];
  return Array.from(counts.entries())
    .map(([key, count]) => ({
      key,
      label: formatFilterLabel(key),
      count,
    }))
    .sort((a, b) => {
      const aIndex = sortOrder.indexOf(a.key);
      const bIndex = sortOrder.indexOf(b.key);
      if (aIndex !== -1 || bIndex !== -1) {
        return (
          (aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex) -
          (bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex)
        );
      }
      return a.label.localeCompare(b.label);
    });
}

function matchesVoiceFilters(
  voice: XaiVoiceOption,
  filters: VoiceFilters,
  searchTerm: string,
): boolean {
  const values = getVoiceFilterValues(voice);
  for (const group of FILTER_GROUPS) {
    const selected = filters[group.key];
    if (
      selected.length > 0 &&
      !selected.some((filter) => values[group.key].includes(filter))
    ) {
      return false;
    }
  }

  const query = searchTerm.trim().toLowerCase();
  if (!query) return true;

  const searchable = [
    voice.voiceId,
    voice.name,
    voice.description,
    voice.type,
    voice.gender,
    voice.tone,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return query
    .split(/\s+/)
    .filter(Boolean)
    .every((part) => searchable.includes(part));
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
  const [showAllVoices, setShowAllVoices] = useState(false);
  const [isVoiceListDismissed, setIsVoiceListDismissed] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filters, setFilters] = useState<VoiceFilters>(EMPTY_FILTERS);
  const [previewingVoiceId, setPreviewingVoiceId] = useState<string | null>(
    null,
  );
  const audioRef = useRef<HTMLAudioElement | null>(null);

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

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

  const activeVoiceId =
    normalizeVoiceId(value.voiceId) || voiceToVoiceId(value.voice);
  const displayedVoices = useMemo(() => mergeVoiceOptions(voices), [voices]);
  const filterOptions = useMemo(
    () => buildFilterOptions(displayedVoices),
    [displayedVoices],
  );
  const hasActiveFilters =
    searchTerm.trim() !== "" ||
    FILTER_GROUPS.some((group) => filters[group.key].length > 0);
  const shouldShowVoiceList =
    !isVoiceListDismissed && (showAllVoices || hasActiveFilters);
  const filteredVoices = useMemo(() => {
    if (!shouldShowVoiceList) return [];
    if (showAllVoices) return displayedVoices;
    return displayedVoices.filter((voice) =>
      matchesVoiceFilters(voice, filters, searchTerm),
    );
  }, [
    displayedVoices,
    filters,
    searchTerm,
    shouldShowVoiceList,
    showAllVoices,
  ]);
  const activeVoiceOption = displayedVoices.find(
    (voice) => normalizeVoiceId(voice.voiceId) === activeVoiceId,
  );
  const activeVoiceLabel =
    activeVoiceOption?.name ?? getVoiceLabel(value.voice, value.voiceId);
  const activeVoiceDescription =
    activeVoiceOption?.description ||
    activeVoiceOption?.tone ||
    activeVoiceId ||
    "Custom voice";

  function toggleFilter(group: VoiceFilterGroup, option: string) {
    setShowAllVoices(false);
    setIsVoiceListDismissed(false);
    setFilters((current) => {
      const selected = new Set(current[group]);
      if (selected.has(option)) {
        selected.delete(option);
      } else {
        selected.add(option);
      }
      return { ...current, [group]: Array.from(selected) };
    });
  }

  function clearFilters() {
    setShowAllVoices(false);
    setIsVoiceListDismissed(false);
    setSearchTerm("");
    setFilters(EMPTY_FILTERS);
  }

  async function handlePreviewVoice(voiceId: string) {
    const normalized = normalizeVoiceId(voiceId);
    if (!normalized) return;
    audioRef.current?.pause();
    audioRef.current = null;
    setPreviewingVoiceId(normalized);
    try {
      const preview = await previewXaiVoice({ voiceId });
      const audio = new Audio(
        `data:${preview.contentType};base64,${preview.audioBase64}`,
      );
      audioRef.current = audio;
      await audio.play();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to preview voice",
      );
    } finally {
      setPreviewingVoiceId((current) =>
        current === normalized ? null : current,
      );
    }
  }

  function renderPreviewButton(voiceId: string, label: string) {
    const normalized = normalizeVoiceId(voiceId);
    const isPreviewing = previewingVoiceId === normalized;
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={(event) => {
              event.stopPropagation();
              void handlePreviewVoice(voiceId);
            }}
            disabled={isPreviewing || !normalized}
            aria-label={`Preview ${label}`}
            data-ocid={`${dataOcidPrefix}.voice_preview.${normalized || "custom"}`}
          >
            {isPreviewing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Volume2 className="h-4 w-4" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>Preview voice</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <div className="space-y-3">
      <div className="space-y-3 rounded-md border border-border bg-muted/10 p-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <p className="truncate text-sm font-semibold text-foreground">
              {activeVoiceLabel}
            </p>
            <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
              {activeVoiceDescription}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {renderPreviewButton(
              activeVoiceOption?.voiceId ?? activeVoiceId,
              activeVoiceLabel,
            )}
            <Button
              type="button"
              variant={showAllVoices ? "secondary" : "outline"}
              size="sm"
              onClick={() => {
                setIsVoiceListDismissed(false);
                if (showAllVoices) {
                  setShowAllVoices(false);
                } else {
                  setSearchTerm("");
                  setFilters(EMPTY_FILTERS);
                  setShowAllVoices(true);
                }
              }}
              data-ocid={`${dataOcidPrefix}.voice_filters.show_all`}
            >
              <ListFilter className="h-4 w-4" />
              {showAllVoices ? "Hide" : "Show all"}
            </Button>
            {(hasActiveFilters || showAllVoices) && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                data-ocid={`${dataOcidPrefix}.voice_filters.clear`}
              >
                <X className="h-4 w-4" />
                Clear
              </Button>
            )}
          </div>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchTerm}
            onChange={(event) => {
              setSearchTerm(event.target.value);
              setShowAllVoices(false);
              setIsVoiceListDismissed(false);
            }}
            placeholder="Search name, tone, or Voice ID"
            className="pl-9"
            data-ocid={`${dataOcidPrefix}.voice_filters.search`}
          />
        </div>

        <div className="space-y-2">
          {FILTER_GROUPS.map((group) => {
            const options = filterOptions[group.key];
            if (options.length === 0) return null;
            if (group.key === "source" && options.length < 2) return null;

            return (
              <div key={group.key} className="space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.label}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {options.map((option) => {
                    const isSelected = filters[group.key].includes(option.key);
                    return (
                      <Button
                        key={option.key}
                        type="button"
                        variant={isSelected ? "secondary" : "outline"}
                        size="sm"
                        className="h-8 gap-1.5 px-2.5 text-xs"
                        onClick={() => toggleFilter(group.key, option.key)}
                        data-ocid={`${dataOcidPrefix}.voice_filters.${group.key}.${option.key}`}
                      >
                        <span>{option.label}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {option.count}
                        </span>
                      </Button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {shouldShowVoiceList && (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                {filteredVoices.length} of {displayedVoices.length} voices
              </p>
              {isLoading && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading
                </div>
              )}
            </div>
            {filteredVoices.length === 0 ? (
              <div className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
                No voices match
              </div>
            ) : (
              <ScrollArea className="max-h-72 rounded-md border border-border bg-background/60">
                <div className="grid grid-cols-1 gap-2 p-2 sm:grid-cols-2 lg:grid-cols-3">
                  {filteredVoices.map((voice) => {
                    const voiceId = normalizeVoiceId(voice.voiceId);
                    const isActive = activeVoiceId === voiceId;
                    const voiceFilters = getVoiceFilterValues(voice);
                    const detailTags = [
                      ...voiceFilters.type,
                      ...voiceFilters.tone.slice(0, 2),
                    ].slice(0, 3);
                    return (
                      <div
                        key={voice.voiceId}
                        className={cn(
                          "flex min-h-24 gap-1 rounded-md border p-1 transition-colors",
                          isActive
                            ? "border-primary/40 bg-secondary text-secondary-foreground"
                            : "border-input bg-background hover:bg-accent hover:text-accent-foreground",
                        )}
                      >
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 flex-col items-start gap-1.5 rounded-sm px-2 py-2 text-left"
                          onClick={() => {
                            const legacyVoice = LEGACY_VOICE_BY_ID[voiceId];
                            onChange({
                              voice: legacyVoice ?? value.voice,
                              voiceId: legacyVoice ? "" : voice.voiceId,
                            });
                            setShowAllVoices(false);
                            setIsVoiceListDismissed(true);
                          }}
                          data-ocid={`${dataOcidPrefix}.preset_voice.${voiceId}`}
                        >
                          <span className="text-sm font-semibold leading-tight">
                            {voice.name || voice.voiceId}
                          </span>
                          <span className="line-clamp-2 text-[10px] leading-tight text-muted-foreground">
                            {voice.description || voice.tone || voice.voiceId}
                          </span>
                          {detailTags.length > 0 && (
                            <span className="flex flex-wrap gap-1 pt-0.5">
                              {detailTags.map((tag) => (
                                <span
                                  key={tag}
                                  className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground"
                                >
                                  {formatFilterLabel(tag)}
                                </span>
                              ))}
                            </span>
                          )}
                        </button>
                        <div className="pt-1">
                          {renderPreviewButton(
                            voice.voiceId,
                            voice.name || voice.voiceId,
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            )}
          </div>
        )}
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
