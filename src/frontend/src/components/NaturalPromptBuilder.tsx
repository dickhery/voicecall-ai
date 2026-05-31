import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  NATURAL_PRESET_TEMPLATES,
  type NaturalPresetConfig,
  type NaturalPromptDirection,
  type NaturalPromptFormality,
  type NaturalPromptPacing,
  type NaturalPromptTone,
  buildNaturalPhonePrompt,
  createNaturalPresetConfig,
  getNaturalPresetTemplate,
} from "@/lib/natural-phone";
import { Info, Wand2 } from "lucide-react";
import { useMemo, useState } from "react";

interface NaturalPromptBuilderProps {
  direction: NaturalPromptDirection;
  onPromptChange: (prompt: string) => void;
  dataOcidPrefix?: string;
}

const TONE_OPTIONS: { value: NaturalPromptTone; label: string }[] = [
  { value: "warm", label: "Warm" },
  { value: "professional", label: "Professional" },
  { value: "casual", label: "Casual" },
  { value: "direct", label: "Direct" },
  { value: "empathetic", label: "Empathetic" },
];

const PACING_OPTIONS: { value: NaturalPromptPacing; label: string }[] = [
  { value: "quick", label: "Quick" },
  { value: "balanced", label: "Balanced" },
  { value: "patient", label: "Patient" },
];

const FORMALITY_OPTIONS: { value: NaturalPromptFormality; label: string }[] = [
  { value: "casual", label: "Casual" },
  { value: "neutral", label: "Neutral" },
  { value: "formal", label: "Formal" },
];

export function NaturalPromptBuilder({
  direction,
  onPromptChange,
  dataOcidPrefix = "natural_prompt",
}: NaturalPromptBuilderProps) {
  const [templateId, setTemplateId] = useState("none");
  const [config, setConfig] = useState<NaturalPresetConfig>(() =>
    createNaturalPresetConfig(),
  );

  const templates = useMemo(
    () =>
      NATURAL_PRESET_TEMPLATES.filter(
        (template) => !template.direction || template.direction === direction,
      ),
    [direction],
  );
  const openingLineHelp =
    direction === "inbound"
      ? "The AI says this first, then waits for the caller before asking follow-up questions."
      : "The AI uses this after the person answers, then waits before moving into the call details.";
  const mustAskHelp =
    direction === "inbound"
      ? "Questions to cover after the caller responds to the opening greeting."
      : "Questions to cover after the person responds to the opening line.";

  function updateConfig<K extends keyof NaturalPresetConfig>(
    key: K,
    value: NaturalPresetConfig[K],
  ) {
    setConfig((current) => ({ ...current, [key]: value }));
  }

  function applyTemplate(nextTemplateId: string) {
    setTemplateId(nextTemplateId);
    const template = getNaturalPresetTemplate(nextTemplateId);
    if (!template) return;
    setConfig((current) =>
      createNaturalPresetConfig({
        ...current,
        ...template.config,
      }),
    );
  }

  function generatePrompt() {
    onPromptChange(buildNaturalPhonePrompt(config, direction));
  }

  return (
    <div
      className="space-y-4 rounded-md border border-border bg-muted/20 p-4"
      data-ocid={`${dataOcidPrefix}.builder`}
    >
      <div className="flex gap-3 rounded-md border border-primary/20 bg-background/70 p-3">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Info className="h-3.5 w-3.5" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">
            Build or write your AI instructions
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Fill out the fields here to describe the agent's role, goals, and
            boundaries. The agent treats the result as private guidance and
            speaks from it in its own words.
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            The opening line is an example for the first turn only; the agent
            keeps the intent, varies the wording, then waits for a response.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1.5 sm:max-w-xs">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            AI Instructions Builder
          </Label>
          <Select value={templateId} onValueChange={applyTemplate}>
            <SelectTrigger
              className="w-full"
              data-ocid={`${dataOcidPrefix}.template.select`}
            >
              <SelectValue placeholder="Choose a template" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Blank</SelectItem>
              {templates.map((template) => (
                <SelectItem key={template.id} value={template.id}>
                  {template.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          type="button"
          variant="secondary"
          className="gap-2"
          onClick={generatePrompt}
          data-ocid={`${dataOcidPrefix}.generate_button`}
        >
          <Wand2 className="h-4 w-4" />
          Generate AI Instructions
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Agent Role</Label>
          <Input
            value={config.agentRole}
            onChange={(event) => updateConfig("agentRole", event.target.value)}
            placeholder="Friendly support assistant"
            data-ocid={`${dataOcidPrefix}.agent_role.input`}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Organization</Label>
          <Input
            value={config.organization}
            onChange={(event) =>
              updateConfig("organization", event.target.value)
            }
            placeholder="Company or project name"
            data-ocid={`${dataOcidPrefix}.organization.input`}
          />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Call Goal</Label>
          <Textarea
            value={config.callPurpose}
            onChange={(event) =>
              updateConfig("callPurpose", event.target.value)
            }
            rows={3}
            placeholder="Confirm the appointment and collect any changes"
            data-ocid={`${dataOcidPrefix}.call_goal.textarea`}
            className="resize-none text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Opening Line</Label>
          <Textarea
            value={config.openingLine}
            onChange={(event) =>
              updateConfig("openingLine", event.target.value)
            }
            rows={3}
            placeholder={
              direction === "inbound"
                ? "Hi, thanks for calling. How can I help?"
                : "Hi, this is the AI assistant calling about your appointment. Is now okay?"
            }
            data-ocid={`${dataOcidPrefix}.opening_line.textarea`}
            className="resize-none text-sm"
          />
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            {openingLineHelp}
          </p>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <PromptSelect
          label="Tone"
          value={config.tone}
          options={TONE_OPTIONS}
          onChange={(value) => updateConfig("tone", value)}
          dataOcid={`${dataOcidPrefix}.tone.select`}
        />
        <PromptSelect
          label="Pacing"
          value={config.pacing}
          options={PACING_OPTIONS}
          onChange={(value) => updateConfig("pacing", value)}
          dataOcid={`${dataOcidPrefix}.pacing.select`}
        />
        <PromptSelect
          label="Formality"
          value={config.formality}
          options={FORMALITY_OPTIONS}
          onChange={(value) => updateConfig("formality", value)}
          dataOcid={`${dataOcidPrefix}.formality.select`}
        />
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <PromptListField
          label="Must Ask"
          value={config.mustAsk}
          onChange={(value) => updateConfig("mustAsk", value)}
          placeholder="One item per line"
          description={mustAskHelp}
          dataOcid={`${dataOcidPrefix}.must_ask.textarea`}
        />
        <PromptListField
          label="Must Mention"
          value={config.mustMention}
          onChange={(value) => updateConfig("mustMention", value)}
          placeholder="One item per line"
          dataOcid={`${dataOcidPrefix}.must_mention.textarea`}
        />
        <PromptListField
          label="Avoid"
          value={config.mustAvoid}
          onChange={(value) => updateConfig("mustAvoid", value)}
          placeholder="One item per line"
          dataOcid={`${dataOcidPrefix}.avoid.textarea`}
        />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">
            Fallback Behavior
          </Label>
          <Textarea
            value={config.fallbackBehavior}
            onChange={(event) =>
              updateConfig("fallbackBehavior", event.target.value)
            }
            rows={3}
            data-ocid={`${dataOcidPrefix}.fallback.textarea`}
            className="resize-none text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">
            Desired Ending
          </Label>
          <Textarea
            value={config.endingGoal}
            onChange={(event) => updateConfig("endingGoal", event.target.value)}
            rows={3}
            placeholder="Confirmed, rescheduled, or ready for follow-up"
            data-ocid={`${dataOcidPrefix}.ending_goal.textarea`}
            className="resize-none text-sm"
          />
        </div>
      </div>
    </div>
  );
}

function PromptSelect<TValue extends string>({
  label,
  value,
  options,
  onChange,
  dataOcid,
}: {
  label: string;
  value: TValue;
  options: { value: TValue; label: string }[];
  onChange: (value: TValue) => void;
  dataOcid: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Select value={value} onValueChange={(next) => onChange(next as TValue)}>
        <SelectTrigger className="w-full" data-ocid={dataOcid}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function PromptListField({
  label,
  value,
  onChange,
  placeholder,
  description,
  dataOcid,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  description?: string;
  dataOcid: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={4}
        placeholder={placeholder}
        data-ocid={dataOcid}
        className="resize-none text-sm"
      />
      {description && (
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          {description}
        </p>
      )}
    </div>
  );
}
