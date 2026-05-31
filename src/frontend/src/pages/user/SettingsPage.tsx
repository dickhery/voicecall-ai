import { AudioFormat, SampleRate, Voice } from "@/backend";
import { AppLayout } from "@/components/AppLayout";
import { NaturalPromptBuilder } from "@/components/NaturalPromptBuilder";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import {
  VoiceIdSelector,
  getVoiceInitial,
  getVoiceLabel,
} from "@/components/VoiceIdSelector";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { useAuth } from "@/hooks/use-auth";
import {
  useCreatePreset,
  useDeletePreset,
  useDuplicatePreset,
  useListMyPresets,
  useUpdatePreset,
} from "@/hooks/use-backend";
import { copyTextToClipboard } from "@/lib/clipboard";
import {
  TURN_TIMING_PROFILES,
  cloneTurnDetection,
  getTurnTimingProfile,
  getTurnTimingProfileId,
  normalizeTurnDetection,
} from "@/lib/natural-phone";
import type { CallPreset, CallPresetInput } from "@/types";
import {
  ChevronDown,
  ChevronUp,
  Copy,
  Loader2,
  LogOut,
  Pencil,
  Plus,
  Save,
  Trash2,
  User,
} from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

// ── Default preset values ──────────────────────────────────────────────────────
const DEFAULT_AUDIO_FORMAT = AudioFormat.pcmu;
const DEFAULT_SAMPLE_RATE = SampleRate.hz8000;
const MAX_AI_INSTRUCTIONS_CHARS = 8000;
const DEFAULT_TURN_DETECTION = cloneTurnDetection(
  TURN_TIMING_PROFILES.find((profile) => profile.id === "balanced")
    ?.turnDetection ?? TURN_TIMING_PROFILES[0].turnDetection,
);
const DEFAULT_TOOLS_ENABLED: CallPresetInput["toolsEnabled"] = {
  xSearch: false,
  webSearch: false,
  functionCalling: false,
};

function createDefaultPreset(): CallPresetInput {
  return {
    name: "",
    voice: Voice.eve,
    voiceId: "",
    systemPrompt: "",
    audioFormat: DEFAULT_AUDIO_FORMAT,
    sampleRate: DEFAULT_SAMPLE_RATE,
    turnDetection: cloneTurnDetection(DEFAULT_TURN_DETECTION),
    toolsEnabled: { ...DEFAULT_TOOLS_ENABLED },
  };
}

function applyHiddenPresetDefaults(input: CallPresetInput): CallPresetInput {
  return {
    ...input,
    audioFormat: DEFAULT_AUDIO_FORMAT,
    sampleRate: DEFAULT_SAMPLE_RATE,
    turnDetection: normalizeTurnDetection(input.turnDetection),
    toolsEnabled: { ...DEFAULT_TOOLS_ENABLED },
  };
}

function parseNumberInputMs(value: string, fallback: bigint): bigint {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return BigInt(Math.max(0, Math.trunc(parsed)));
}

const defaultPreset = createDefaultPreset();
const defaultTurnDetection = defaultPreset.turnDetection;
const defaultTimingText = {
  threshold: `Default: ${defaultTurnDetection.threshold.toFixed(2)}`,
  silenceDuration: `Default: ${Number(defaultTurnDetection.silenceDurationMs)}ms`,
  prefixPadding: `Default: ${Number(defaultTurnDetection.prefixPaddingMs)}ms`,
};

const TURN_DETECTION_HELP =
  "Choose how quickly the AI responds after the caller pauses. Use Patient listener if callers often pause mid-sentence.";

// ── Preset Form ────────────────────────────────────────────────────────────────
interface PresetFormProps {
  initial?: CallPreset;
  onSave: (input: CallPresetInput) => Promise<void>;
  onCancel?: () => void;
  isLoading?: boolean;
}

function PresetForm({ initial, onSave, onCancel, isLoading }: PresetFormProps) {
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<CallPresetInput>({
    defaultValues: initial
      ? {
          name: initial.name,
          voice: initial.voice,
          voiceId: initial.voiceId ?? "",
          systemPrompt: initial.systemPrompt,
          audioFormat: DEFAULT_AUDIO_FORMAT,
          sampleRate: DEFAULT_SAMPLE_RATE,
          turnDetection: normalizeTurnDetection(initial.turnDetection),
          toolsEnabled: { ...DEFAULT_TOOLS_ENABLED },
        }
      : createDefaultPreset(),
  });

  const values = watch();
  const submitPreset = handleSubmit((input) =>
    onSave(applyHiddenPresetDefaults(input)),
  );

  const silenceMs = values.turnDetection?.silenceDurationMs ?? 500n;
  const prefixMs = values.turnDetection?.prefixPaddingMs ?? 200n;
  const timingProfileId = getTurnTimingProfileId({
    ...values.turnDetection,
    serverVad: true,
  });

  function applyTimingProfile(profileId: string) {
    const profile = getTurnTimingProfile(profileId);
    if (!profile) return;
    setValue("turnDetection", cloneTurnDetection(profile.turnDetection), {
      shouldDirty: true,
      shouldValidate: true,
    });
  }

  function normalizeTimingValues() {
    setValue(
      "turnDetection",
      normalizeTurnDetection({
        ...values.turnDetection,
        serverVad: true,
      }),
      {
        shouldDirty: true,
        shouldValidate: true,
      },
    );
  }

  return (
    <form onSubmit={submitPreset} className="space-y-6" noValidate>
      {/* Preset Name */}
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Preset Name
        </Label>
        <Input
          {...register("name", { required: "Name is required" })}
          placeholder="e.g. Customer Support Bot"
          data-ocid="settings.preset.name.input"
          className={errors.name ? "border-destructive" : ""}
        />
        {errors.name && (
          <p
            className="text-xs text-destructive"
            data-ocid="settings.preset.name.field_error"
          >
            {errors.name.message}
          </p>
        )}
      </div>

      <NaturalPromptBuilder
        direction="outbound"
        onPromptChange={(prompt) =>
          setValue("systemPrompt", prompt, {
            shouldDirty: true,
            shouldValidate: true,
          })
        }
        dataOcidPrefix="settings.preset.natural_prompt"
      />

      {/* System Prompt */}
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          AI Instructions
        </Label>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Describe the role, goal, facts, and boundaries. Avoid "say exactly"
          wording unless a specific phrase must stay fixed.
        </p>
        <Textarea
          {...register("systemPrompt", {
            required: "System prompt is required",
            validate: (value) =>
              value.trim().length > 0 || "System prompt is required",
            maxLength: {
              value: MAX_AI_INSTRUCTIONS_CHARS,
              message: "System prompt is too long",
            },
          })}
          placeholder="Describe how the AI should introduce itself, what it should accomplish, what it must ask later in the call, and anything it should avoid."
          rows={5}
          maxLength={MAX_AI_INSTRUCTIONS_CHARS}
          data-ocid="settings.preset.system_prompt.textarea"
          className={`resize-none font-mono text-xs leading-relaxed ${
            errors.systemPrompt ? "border-destructive" : ""
          }`}
        />
        {errors.systemPrompt && (
          <p
            className="text-xs text-destructive"
            data-ocid="settings.preset.system_prompt.field_error"
          >
            {errors.systemPrompt.message}
          </p>
        )}
      </div>

      {/* Voice Selector */}
      <div className="space-y-2">
        <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Voice
        </Label>
        <VoiceIdSelector
          value={{ voice: values.voice, voiceId: values.voiceId }}
          onChange={(next) => {
            setValue("voice", next.voice);
            setValue("voiceId", next.voiceId ?? "");
          }}
          dataOcidPrefix="settings"
        />
      </div>

      {/* Turn Detection */}
      <div className="space-y-4 p-4 rounded-lg bg-muted/20 border border-border">
        <div className="space-y-3">
          <div className="space-y-1">
            <p className="text-xs font-semibold text-foreground uppercase tracking-wide">
              Conversation Timing
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed">
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
                data-ocid="settings.preset.turn_profile.select"
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
              <p className="text-[10px] text-muted-foreground leading-tight">
                Required for live phone calls through the xAI realtime bridge.
              </p>
            </div>
            <Switch
              checked
              disabled
              data-ocid="settings.preset.server_vad.switch"
              className="shrink-0"
            />
          </div>
        </div>

        {/* Threshold slider */}
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <Label className="text-xs text-muted-foreground">
              Speech Sensitivity
            </Label>
            <span className="text-xs font-mono text-primary tabular-nums">
              {(values.turnDetection?.threshold ?? 0.5).toFixed(2)}
            </span>
          </div>
          <Slider
            min={0}
            max={1}
            step={0.01}
            value={[values.turnDetection?.threshold ?? 0.5]}
            onValueChange={([v]) => setValue("turnDetection.threshold", v)}
            data-ocid="settings.preset.threshold.slider"
            className="py-1"
          />
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            Lower values make the AI more sensitive to quieter speech. Raise it
            if background noise keeps the AI from responding.{" "}
            {defaultTimingText.threshold}
          </p>
        </div>

        {/* Silence Duration + Prefix Padding */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
              onChange={(e) =>
                setValue(
                  "turnDetection.silenceDurationMs",
                  parseNumberInputMs(e.target.value, silenceMs),
                )
              }
              onBlur={normalizeTimingValues}
              data-ocid="settings.preset.silence_duration.input"
              className="font-mono text-sm"
            />
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              How long the caller should be quiet before the AI starts
              answering. Increase this if it cuts people off; decrease it if it
              feels slow. {defaultTimingText.silenceDuration}
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
              onChange={(e) =>
                setValue(
                  "turnDetection.prefixPaddingMs",
                  parseNumberInputMs(e.target.value, prefixMs),
                )
              }
              onBlur={normalizeTimingValues}
              data-ocid="settings.preset.prefix_padding.input"
              className="font-mono text-sm"
            />
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              Keeps a small amount of audio from just before speech starts so
              first words do not get clipped. {defaultTimingText.prefixPadding}
            </p>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        {onCancel && (
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            onClick={onCancel}
            data-ocid="settings.preset.cancel_button"
          >
            Cancel
          </Button>
        )}
        <Button
          type="submit"
          disabled={isLoading}
          className="flex-1 gap-2"
          data-ocid="settings.preset.save_button"
        >
          {isLoading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          {isLoading ? "Saving…" : initial ? "Update Preset" : "Create Preset"}
        </Button>
      </div>
    </form>
  );
}

// ── Settings Page ──────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const { data: presets, isLoading: presetsLoading } = useListMyPresets();
  const createPreset = useCreatePreset();
  const updatePreset = useUpdatePreset();
  const deletePreset = useDeletePreset();
  const duplicatePreset = useDuplicatePreset();
  const { principal, logout, isAdmin } = useAuth();
  const userId = principal?.toString() ?? "";

  const [expandedPreset, setExpandedPreset] = useState<string | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);

  const handleCreate = async (input: CallPresetInput) => {
    await createPreset.mutateAsync(input);
    toast.success("Preset created");
    setShowNewForm(false);
  };

  const handleUpdate = async (id: bigint, input: CallPresetInput) => {
    await updatePreset.mutateAsync({ id, input });
    toast.success("Preset updated");
    setExpandedPreset(null);
  };

  const handleDelete = async (id: bigint) => {
    await deletePreset.mutateAsync(id);
    toast.success("Preset deleted");
  };

  const handleDuplicate = async (id: bigint) => {
    await duplicatePreset.mutateAsync(id);
    toast.success("Preset duplicated");
  };

  const handleCopyUserId = async () => {
    if (!userId) {
      toast.error("User ID is not available");
      return;
    }
    try {
      const copied = await copyTextToClipboard(userId);
      if (!copied) {
        throw new Error("Copy command was rejected.");
      }
      toast.success("User ID copied");
    } catch {
      toast.error("Unable to copy User ID", {
        description: "Select the User ID text and copy it manually.",
      });
    }
  };

  return (
    <ProtectedRoute>
      <AppLayout>
        <div className="p-6 space-y-8 max-w-3xl" data-ocid="settings.page">
          {/* Header */}
          <div>
            <h1 className="font-display text-2xl font-bold text-foreground">
              Settings
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Manage your call presets and account
            </p>
          </div>

          {/* User Profile Section */}
          <Card
            className="bg-card border-border"
            data-ocid="settings.profile.card"
          >
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
                  <User className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-sm font-semibold">
                    Your Profile
                  </CardTitle>
                  <CardDescription className="text-xs">
                    {isAdmin ? "Administrator" : "Standard User"}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              <div className="flex flex-col gap-1">
                <Label className="text-xs text-muted-foreground">User ID</Label>
                <div className="flex items-center gap-2">
                  <code
                    className="flex-1 text-xs font-mono bg-muted/40 rounded-md px-3 py-2 text-foreground truncate"
                    data-ocid="settings.profile.user_id"
                    title={userId || "Not connected"}
                  >
                    {userId || "Not connected"}
                  </code>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={handleCopyUserId}
                    disabled={!userId}
                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                    data-ocid="settings.profile.copy_user_id_button"
                    title="Copy User ID"
                    aria-label="Copy User ID"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={logout}
                className="gap-2 text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
                data-ocid="settings.profile.logout_button"
              >
                <LogOut className="w-4 h-4" />
                Sign out
              </Button>
            </CardContent>
          </Card>

          {/* Presets Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-display text-lg font-semibold text-foreground">
                  Call Presets
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Configure AI voice, instructions, and conversation timing for
                  your calls
                </p>
              </div>
              <Button
                onClick={() => setShowNewForm(!showNewForm)}
                data-ocid="settings.new_preset_button"
                className="gap-2"
                size="sm"
              >
                <Plus className="w-4 h-4" />
                New Preset
              </Button>
            </div>

            {/* New preset form */}
            {showNewForm && (
              <Card
                className="bg-card border-primary/30 shadow-sm"
                data-ocid="settings.new_preset.card"
              >
                <CardHeader className="pb-4">
                  <CardTitle className="text-base">New Preset</CardTitle>
                  <CardDescription>
                    Generate AI instructions or write your own, choose a voice,
                    and tune the conversation timing.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <PresetForm
                    onSave={handleCreate}
                    onCancel={() => setShowNewForm(false)}
                    isLoading={createPreset.isPending}
                  />
                </CardContent>
              </Card>
            )}

            {/* Loading skeletons */}
            {presetsLoading && (
              <div
                className="space-y-3"
                data-ocid="settings.presets.loading_state"
              >
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-16 w-full rounded-xl" />
                ))}
              </div>
            )}

            {/* Empty state */}
            {!presetsLoading &&
              (presets ?? []).length === 0 &&
              !showNewForm && (
                <div
                  className="flex flex-col items-center justify-center text-center py-14 rounded-xl border border-dashed border-border bg-muted/10"
                  data-ocid="settings.presets.empty_state"
                >
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
                    <Plus className="w-6 h-6 text-primary" />
                  </div>
                  <p className="text-sm font-medium text-foreground">
                    No presets yet
                  </p>
                  <p className="text-xs text-muted-foreground mt-1 mb-4">
                    Create your first call preset to get started
                  </p>
                  <Button
                    size="sm"
                    onClick={() => setShowNewForm(true)}
                    className="gap-2"
                    data-ocid="settings.empty_state.create_button"
                  >
                    <Plus className="w-4 h-4" />
                    Create Preset
                  </Button>
                </div>
              )}

            {/* Preset list */}
            {!presetsLoading && (presets ?? []).length > 0 && (
              <div className="space-y-3">
                {(presets ?? []).map((preset: CallPreset, idx) => {
                  const isExpanded = expandedPreset === preset.id.toString();
                  return (
                    <Card
                      key={preset.id.toString()}
                      data-ocid={`settings.preset.item.${idx + 1}`}
                      className={`bg-card border-border transition-smooth ${
                        isExpanded ? "border-primary/40 shadow-sm" : ""
                      }`}
                    >
                      {/* Preset header row */}
                      <div className="flex items-center gap-2 px-4 py-3">
                        <button
                          type="button"
                          className="flex-1 flex items-center gap-3 text-left min-w-0 hover:opacity-80 transition-smooth"
                          onClick={() =>
                            setExpandedPreset(
                              isExpanded ? null : preset.id.toString(),
                            )
                          }
                          data-ocid={`settings.preset.expand_button.${idx + 1}`}
                        >
                          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                            <span className="text-xs font-bold text-primary">
                              {getVoiceInitial(preset.voice, preset.voiceId)}
                            </span>
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-foreground truncate">
                              {preset.name}
                            </p>
                            <p className="text-[11px] text-muted-foreground mt-0.5">
                              {getVoiceLabel(preset.voice, preset.voiceId)} ·{" "}
                              {preset.systemPrompt.substring(0, 70)}
                              {preset.systemPrompt.length > 70 ? "..." : ""}
                            </p>
                          </div>
                        </button>

                        {/* Quick actions */}
                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="w-8 h-8 text-muted-foreground hover:text-foreground"
                            onClick={() =>
                              setExpandedPreset(preset.id.toString())
                            }
                            data-ocid={`settings.preset.edit_button.${idx + 1}`}
                            title="Edit preset"
                            aria-label="Edit preset"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="w-8 h-8 text-muted-foreground hover:text-foreground"
                            onClick={() => handleDuplicate(preset.id)}
                            disabled={duplicatePreset.isPending}
                            data-ocid={`settings.preset.duplicate_button.${idx + 1}`}
                            title="Duplicate preset"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="w-8 h-8 text-muted-foreground hover:text-destructive"
                            onClick={() => handleDelete(preset.id)}
                            disabled={deletePreset.isPending}
                            data-ocid={`settings.preset.delete_button.${idx + 1}`}
                            title="Delete preset"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                          <button
                            type="button"
                            className="w-8 h-8 flex items-center justify-center text-muted-foreground hover:text-foreground transition-smooth rounded-md"
                            onClick={() =>
                              setExpandedPreset(
                                isExpanded ? null : preset.id.toString(),
                              )
                            }
                            aria-label={isExpanded ? "Collapse" : "Expand"}
                          >
                            {isExpanded ? (
                              <ChevronUp className="w-4 h-4" />
                            ) : (
                              <ChevronDown className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      </div>

                      {/* Expanded edit form */}
                      {isExpanded && (
                        <CardContent className="border-t border-border pt-5">
                          <PresetForm
                            initial={preset}
                            onSave={(input) => handleUpdate(preset.id, input)}
                            onCancel={() => setExpandedPreset(null)}
                            isLoading={updatePreset.isPending}
                          />
                        </CardContent>
                      )}
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </AppLayout>
    </ProtectedRoute>
  );
}
