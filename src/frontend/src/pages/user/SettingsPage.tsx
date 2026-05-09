import { AudioFormat, SampleRate, Voice } from "@/backend";
import { AppLayout } from "@/components/AppLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
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
import type { CallPreset, CallPresetInput } from "@/types";
import {
  ChevronDown,
  ChevronUp,
  Copy,
  Loader2,
  LogOut,
  Plus,
  Save,
  Trash2,
  User,
} from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

// ── Default preset values ──────────────────────────────────────────────────────
const defaultPreset: CallPresetInput = {
  name: "",
  voice: Voice.eve,
  systemPrompt: "",
  audioFormat: AudioFormat.pcmu,
  sampleRate: SampleRate.hz8000,
  turnDetection: {
    serverVad: true,
    threshold: 0.5,
    prefixPaddingMs: 200n,
    silenceDurationMs: 500n,
  },
  toolsEnabled: { xSearch: false, webSearch: false, functionCalling: false },
};

// ── Voice metadata ─────────────────────────────────────────────────────────────
const VOICE_META: Record<Voice, { label: string; description: string }> = {
  [Voice.eve]: { label: "Eve", description: "Warm, conversational" },
  [Voice.ara]: { label: "Ara", description: "Clear, professional" },
  [Voice.rex]: { label: "Rex", description: "Deep, authoritative" },
  [Voice.sal]: { label: "Sal", description: "Friendly, upbeat" },
  [Voice.leo]: { label: "Leo", description: "Calm, deliberate" },
};

// ── Sample rate display labels ─────────────────────────────────────────────────
const SAMPLE_RATE_LABELS: Record<SampleRate, string> = {
  [SampleRate.hz8000]: "8,000 Hz (8 kHz)",
  [SampleRate.hz16000]: "16,000 Hz (16 kHz)",
  [SampleRate.hz22050]: "22,050 Hz (22.05 kHz)",
  [SampleRate.hz24000]: "24,000 Hz (24 kHz)",
  [SampleRate.hz32000]: "32,000 Hz (32 kHz)",
  [SampleRate.hz44100]: "44,100 Hz (44.1 kHz)",
  [SampleRate.hz48000]: "48,000 Hz (48 kHz)",
};

// ── Audio format labels ────────────────────────────────────────────────────────
const AUDIO_FORMAT_LABELS: Record<AudioFormat, string> = {
  [AudioFormat.pcmu]: "PCMU (G.711 µ-law)",
  [AudioFormat.pcm]: "PCM (Linear)",
  [AudioFormat.pcma]: "PCMA (G.711 A-law)",
};

// ── Voice Card Selector ────────────────────────────────────────────────────────
function VoiceCardSelector({
  value,
  onChange,
}: {
  value: Voice;
  onChange: (v: Voice) => void;
}) {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
      {(Object.values(Voice) as Voice[]).map((v) => {
        const meta = VOICE_META[v];
        const isActive = value === v;
        return (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            data-ocid={`settings.preset.voice.${v}`}
            className={[
              "flex flex-col items-center gap-1 rounded-lg border p-3 text-center transition-smooth cursor-pointer",
              isActive
                ? "border-primary bg-primary/10 text-primary shadow-sm"
                : "border-border bg-card hover:border-primary/40 hover:bg-muted/20 text-muted-foreground hover:text-foreground",
            ].join(" ")}
          >
            <span
              className={`text-sm font-semibold ${isActive ? "text-primary" : "text-foreground"}`}
            >
              {meta.label}
            </span>
            <span className="text-[10px] leading-tight opacity-70">
              {meta.description}
            </span>
          </button>
        );
      })}
    </div>
  );
}

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
          systemPrompt: initial.systemPrompt,
          audioFormat: initial.audioFormat,
          sampleRate: initial.sampleRate,
          turnDetection: initial.turnDetection,
          toolsEnabled: initial.toolsEnabled,
        }
      : defaultPreset,
  });

  const values = watch();

  const silenceMs = values.turnDetection?.silenceDurationMs ?? 500n;
  const prefixMs = values.turnDetection?.prefixPaddingMs ?? 200n;

  return (
    <form onSubmit={handleSubmit(onSave)} className="space-y-6">
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

      {/* System Prompt */}
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          AI Instructions / System Prompt
        </Label>
        <Textarea
          {...register("systemPrompt", {
            required: "System prompt is required",
          })}
          placeholder="You are a professional sales representative. Greet the customer warmly, ask how you can help them today, and guide them through..."
          rows={5}
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
        <VoiceCardSelector
          value={values.voice}
          onChange={(v) => setValue("voice", v)}
        />
      </div>

      {/* Turn Detection */}
      <div className="space-y-4 p-4 rounded-xl bg-muted/20 border border-border">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-foreground uppercase tracking-wide">
            Turn Detection
          </p>
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">Server VAD</Label>
            <Switch
              checked={values.turnDetection?.serverVad ?? true}
              onCheckedChange={(v) => setValue("turnDetection.serverVad", v)}
              data-ocid="settings.preset.server_vad.switch"
            />
          </div>
        </div>

        {/* Threshold slider */}
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <Label className="text-xs text-muted-foreground">
              VAD Threshold
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
          <p className="text-[10px] text-muted-foreground">
            Sensitivity for detecting end-of-speech. Lower = more sensitive
            (0.0–1.0).
          </p>
        </div>

        {/* Silence Duration + Prefix Padding */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              Silence Duration (ms)
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
                  BigInt(e.target.value || "0"),
                )
              }
              data-ocid="settings.preset.silence_duration.input"
              className="font-mono text-sm"
            />
            <p className="text-[10px] text-muted-foreground">Default: 500ms</p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              Prefix Padding (ms)
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
                  BigInt(e.target.value || "0"),
                )
              }
              data-ocid="settings.preset.prefix_padding.input"
              className="font-mono text-sm"
            />
            <p className="text-[10px] text-muted-foreground">Default: 200ms</p>
          </div>
        </div>
      </div>

      {/* Audio Output */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Output Format
          </Label>
          <Select
            value={values.audioFormat}
            onValueChange={(v) => setValue("audioFormat", v as AudioFormat)}
          >
            <SelectTrigger data-ocid="settings.preset.audio_format.select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.values(AudioFormat) as AudioFormat[]).map((f) => (
                <SelectItem key={f} value={f}>
                  {AUDIO_FORMAT_LABELS[f]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Sample Rate
          </Label>
          <Select
            value={values.sampleRate}
            onValueChange={(v) => setValue("sampleRate", v as SampleRate)}
          >
            <SelectTrigger data-ocid="settings.preset.sample_rate.select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.values(SampleRate) as SampleRate[]).map((r) => (
                <SelectItem key={r} value={r}>
                  {SAMPLE_RATE_LABELS[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Tools */}
      <div className="space-y-3 p-4 rounded-xl bg-muted/20 border border-border">
        <p className="text-xs font-semibold text-foreground uppercase tracking-wide">
          Enabled Tools
        </p>
        {[
          {
            key: "webSearch" as const,
            label: "Web Search",
            description: "AI can search the internet during the call",
          },
          {
            key: "xSearch" as const,
            label: "X (Twitter) Search",
            description: "AI can search X/Twitter for real-time info",
          },
          {
            key: "functionCalling" as const,
            label: "Function Calling",
            description: "AI can invoke custom functions you define",
          },
        ].map(({ key, label, description }) => (
          <div key={key} className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-medium text-foreground">{label}</p>
              <p className="text-[10px] text-muted-foreground leading-tight">
                {description}
              </p>
            </div>
            <Switch
              checked={values.toolsEnabled?.[key] ?? false}
              onCheckedChange={(v) => setValue(`toolsEnabled.${key}`, v)}
              data-ocid={`settings.preset.${key}.switch`}
            />
          </div>
        ))}
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
                <Label className="text-xs text-muted-foreground">
                  Principal ID
                </Label>
                <div className="flex items-center gap-2">
                  <code
                    className="flex-1 text-xs font-mono bg-muted/40 rounded-md px-3 py-2 text-foreground truncate"
                    data-ocid="settings.profile.principal_id"
                    title={principal?.toString() ?? "Not connected"}
                  >
                    {principal?.toString() ?? "Not connected"}
                  </code>
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
                  Configure AI voice, prompts, and audio settings for your calls
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
                    Configure a new AI call profile with voice, audio, and tool
                    settings
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
                              {VOICE_META[preset.voice]?.label?.[0] ?? "?"}
                            </span>
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-foreground truncate">
                              {preset.name}
                            </p>
                            <p className="text-[11px] text-muted-foreground mt-0.5">
                              {VOICE_META[preset.voice]?.label} ·{" "}
                              {AUDIO_FORMAT_LABELS[preset.audioFormat]} ·{" "}
                              {SAMPLE_RATE_LABELS[preset.sampleRate]}
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
