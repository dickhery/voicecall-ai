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
import { ChevronDown, ChevronUp, Info, Wand2 } from "lucide-react";
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
  const [isOpen, setIsOpen] = useState(false);
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
    <div className="space-y-3" data-ocid={`${dataOcidPrefix}.builder_wrapper`}>
      <div className="rounded-md border border-border bg-muted/20 p-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 gap-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Wand2 className="h-4 w-4" />
            </div>
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-medium text-foreground">
                AI Instructions Builder
              </p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Open guided fields to generate a starting prompt, or type your
                own instructions directly in the AI Instructions box below.
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant={isOpen ? "secondary" : "outline"}
            className="w-full shrink-0 justify-center gap-2 sm:w-auto"
            onClick={() => setIsOpen((open) => !open)}
            aria-expanded={isOpen}
            aria-controls={`${dataOcidPrefix}-builder-panel`}
            data-ocid={`${dataOcidPrefix}.toggle_button`}
          >
            {isOpen ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
            {isOpen ? "Hide Builder" : "Open Builder"}
          </Button>
        </div>
      </div>

      {isOpen && (
        <div
          id={`${dataOcidPrefix}-builder-panel`}
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
                Fill out structured fields for the agent's role, goals, expected
                questions, and boundaries. Generate the prompt, then freely edit
                the final AI Instructions text before saving.
              </p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Put the exact name or identity the AI should say in Agent Role,
                then use the opening line only for the first turn.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-1.5 sm:max-w-xs">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Template
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

          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                Agent Role
              </Label>
              <Input
                value={config.agentRole}
                onChange={(event) =>
                  updateConfig("agentRole", event.target.value)
                }
                placeholder="Jordan Rivera from Acme support"
                data-ocid={`${dataOcidPrefix}.agent_role.input`}
              />
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                Use the exact name, title, or role the AI should introduce
                itself with.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                Organization
              </Label>
              <Input
                value={config.organization}
                onChange={(event) =>
                  updateConfig("organization", event.target.value)
                }
                placeholder="Company or project name"
                data-ocid={`${dataOcidPrefix}.organization.input`}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                Relationship
              </Label>
              <Input
                value={config.relationshipToCaller}
                onChange={(event) =>
                  updateConfig("relationshipToCaller", event.target.value)
                }
                placeholder="Front desk, callback helper, teammate"
                data-ocid={`${dataOcidPrefix}.relationship.input`}
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
              <Label className="text-xs text-muted-foreground">
                Opening Line
              </Label>
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

          <div className="space-y-3">
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-foreground">
                Context and Expected Questions
              </p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Add facts the agent should know before the call, including
                likely questions and the answer to give when they come up.
              </p>
            </div>
            <div className="grid gap-3 lg:grid-cols-[0.85fr_1.15fr]">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  Expected Situation
                </Label>
                <Textarea
                  value={config.expectedSituation}
                  onChange={(event) =>
                    updateConfig("expectedSituation", event.target.value)
                  }
                  rows={4}
                  placeholder="They may be calling after hours, or they may already know the team."
                  data-ocid={`${dataOcidPrefix}.expected_situation.textarea`}
                  className="resize-none text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  If / Then Guidance
                </Label>
                <Textarea
                  value={config.conditionalGuidance}
                  onChange={(event) =>
                    updateConfig("conditionalGuidance", event.target.value)
                  }
                  rows={4}
                  placeholder={
                    "If asked about my mom, say she is doing well.\nIf they ask about pricing, explain that a human can follow up with exact options.\nIf they want a human, offer to take a detailed message."
                  }
                  data-ocid={`${dataOcidPrefix}.conditional_guidance.textarea`}
                  className="resize-none text-sm"
                />
                <p className="text-[10px] leading-relaxed text-muted-foreground">
                  Use one expected question, scenario, or fact per line.
                </p>
              </div>
            </div>
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
                onChange={(event) =>
                  updateConfig("endingGoal", event.target.value)
                }
                rows={3}
                placeholder="Confirmed, rescheduled, or ready for follow-up"
                data-ocid={`${dataOcidPrefix}.ending_goal.textarea`}
                className="resize-none text-sm"
              />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                Handoff Instructions
              </Label>
              <Textarea
                value={config.handoffInstructions}
                onChange={(event) =>
                  updateConfig("handoffInstructions", event.target.value)
                }
                rows={3}
                placeholder="When a human should follow up and what details to collect"
                data-ocid={`${dataOcidPrefix}.handoff.textarea`}
                className="resize-none text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                Extra Instructions
              </Label>
              <Textarea
                value={config.extraInstructions}
                onChange={(event) =>
                  updateConfig("extraInstructions", event.target.value)
                }
                rows={3}
                placeholder="Anything else the agent should know or avoid"
                data-ocid={`${dataOcidPrefix}.extra.textarea`}
                className="resize-none text-sm"
              />
            </div>
          </div>
        </div>
      )}
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
