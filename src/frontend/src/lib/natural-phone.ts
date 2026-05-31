import type { TurnDetection } from "@/types";

export type NaturalPromptDirection = "outbound" | "inbound";
export type NaturalPromptTone =
  | "warm"
  | "professional"
  | "casual"
  | "direct"
  | "empathetic";
export type NaturalPromptPacing = "quick" | "balanced" | "patient";
export type NaturalPromptFormality = "casual" | "neutral" | "formal";

export interface NaturalPresetConfig {
  agentRole: string;
  organization: string;
  relationshipToCaller: string;
  callPurpose: string;
  openingLine: string;
  tone: NaturalPromptTone;
  pacing: NaturalPromptPacing;
  formality: NaturalPromptFormality;
  expectedSituation: string;
  mustAsk: string;
  mustMention: string;
  mustAvoid: string;
  fallbackBehavior: string;
  handoffInstructions: string;
  endingGoal: string;
  extraInstructions: string;
}

export interface NaturalPresetTemplate {
  id: string;
  label: string;
  direction?: NaturalPromptDirection;
  config: Partial<NaturalPresetConfig>;
}

export interface TurnTimingProfile {
  id: string;
  label: string;
  turnDetection: TurnDetection;
}

export const DEFAULT_NATURAL_PRESET_CONFIG: NaturalPresetConfig = {
  agentRole: "",
  organization: "",
  relationshipToCaller: "",
  callPurpose: "",
  openingLine: "",
  tone: "warm",
  pacing: "balanced",
  formality: "neutral",
  expectedSituation: "",
  mustAsk: "",
  mustMention: "",
  mustAvoid: "",
  fallbackBehavior:
    "If you are unsure, ask one short clarifying question instead of guessing.",
  handoffInstructions: "",
  endingGoal: "",
  extraInstructions: "",
};

export const NATURAL_PRESET_TEMPLATES: NaturalPresetTemplate[] = [
  {
    id: "appointment-confirmation",
    label: "Appointment Confirmation",
    direction: "outbound",
    config: {
      agentRole: "Friendly appointment confirmation assistant",
      callPurpose: "Confirm whether the appointment time still works.",
      openingLine:
        "Hi, this is the AI assistant calling about your appointment. Is now still an okay time?",
      tone: "warm",
      pacing: "balanced",
      mustAsk:
        "Confirm the date and time\nAsk whether they need to reschedule\nConfirm the best callback number if needed",
      mustMention: "Why you are calling",
      mustAvoid:
        "Do not sound pushy\nDo not ask for payment details\nDo not continue if they say they are busy; offer to call later",
      fallbackBehavior:
        "If they ask something you do not know, say you can pass the message along.",
      endingGoal:
        "End with the appointment confirmed, rescheduled, or flagged for follow-up.",
    },
  },
  {
    id: "customer-support",
    label: "Customer Support",
    config: {
      agentRole: "Helpful customer support phone agent",
      callPurpose:
        "Understand the issue, collect the key details, and help with the next step.",
      openingLine:
        "Hi, this is the AI support assistant. How can I help today?",
      tone: "empathetic",
      pacing: "patient",
      mustAsk:
        "Ask for the caller's name\nAsk what they need help with\nAsk one follow-up question before suggesting a next step",
      mustMention:
        "You can take a message or pass details to the team when needed",
      mustAvoid:
        "Do not blame the caller\nDo not overpromise a resolution\nDo not ask multiple questions at once",
      fallbackBehavior:
        "If the answer depends on private account details, offer to take a message for a human follow-up.",
    },
  },
  {
    id: "lead-qualification",
    label: "Lead Qualification",
    direction: "outbound",
    config: {
      agentRole: "Professional lead qualification assistant",
      callPurpose:
        "Learn whether the person is a good fit and whether they want a follow-up.",
      openingLine:
        "Hi, this is the AI assistant following up on your interest. Is now a quick okay time?",
      tone: "professional",
      pacing: "quick",
      mustAsk:
        "Ask what they are looking for\nAsk their timeline\nAsk the best way for the team to follow up",
      mustMention: "Keep the call brief unless they ask for details",
      mustAvoid:
        "Do not pressure the person\nDo not make pricing promises\nDo not keep talking if they are not interested",
      endingGoal: "Capture fit, timeline, and follow-up preference.",
    },
  },
  {
    id: "basic-receptionist",
    label: "Basic Receptionist",
    direction: "inbound",
    config: {
      agentRole: "Calm front desk answering assistant",
      callPurpose:
        "Greet callers, understand why they called, and take a useful message.",
      openingLine:
        "Hi, thanks for calling. This is the AI assistant. How can I help?",
      tone: "warm",
      pacing: "balanced",
      mustAsk:
        "Ask for the caller's name\nAsk the reason for the call\nAsk the best callback number if a follow-up is needed",
      mustMention: "You can pass the message along",
      mustAvoid:
        "Do not pretend to be a human\nDo not invent policies or availability\nDo not ask for sensitive payment information",
      endingGoal:
        "Finish with a clear message or answer and a polite sign-off.",
    },
  },
  {
    id: "missed-call-callback",
    label: "Missed Call Callback",
    direction: "outbound",
    config: {
      agentRole: "Brief callback assistant",
      callPurpose:
        "Return a missed call, find out what the person needed, and capture next steps.",
      openingLine:
        "Hi, this is the AI assistant returning your call. Is now still a good time?",
      tone: "casual",
      pacing: "balanced",
      mustAsk:
        "Ask what they were calling about\nAsk whether they still need help\nAsk for the best next step",
      mustAvoid:
        "Do not talk over them\nDo not continue if they say they are busy",
    },
  },
];

export const TURN_TIMING_PROFILES: TurnTimingProfile[] = [
  {
    id: "fast",
    label: "Fast and responsive",
    turnDetection: {
      serverVad: true,
      threshold: 0.45,
      silenceDurationMs: 350n,
      prefixPaddingMs: 250n,
    },
  },
  {
    id: "balanced",
    label: "Balanced",
    turnDetection: {
      serverVad: true,
      threshold: 0.55,
      silenceDurationMs: 500n,
      prefixPaddingMs: 333n,
    },
  },
  {
    id: "patient",
    label: "Patient listener",
    turnDetection: {
      serverVad: true,
      threshold: 0.6,
      silenceDurationMs: 800n,
      prefixPaddingMs: 333n,
    },
  },
  {
    id: "noisy",
    label: "Noisy environment",
    turnDetection: {
      serverVad: true,
      threshold: 0.75,
      silenceDurationMs: 650n,
      prefixPaddingMs: 333n,
    },
  },
];

export function createNaturalPresetConfig(
  overrides: Partial<NaturalPresetConfig> = {},
): NaturalPresetConfig {
  return { ...DEFAULT_NATURAL_PRESET_CONFIG, ...overrides };
}

export function getNaturalPresetTemplate(
  id: string,
): NaturalPresetTemplate | undefined {
  return NATURAL_PRESET_TEMPLATES.find((template) => template.id === id);
}

export function cloneTurnDetection(
  turnDetection: TurnDetection,
): TurnDetection {
  return {
    serverVad: true,
    threshold: turnDetection.threshold,
    silenceDurationMs: turnDetection.silenceDurationMs,
    prefixPaddingMs: turnDetection.prefixPaddingMs,
  };
}

export function getTurnTimingProfile(
  id: string,
): TurnTimingProfile | undefined {
  return TURN_TIMING_PROFILES.find((profile) => profile.id === id);
}

export function getTurnTimingProfileId(turnDetection: TurnDetection): string {
  const match = TURN_TIMING_PROFILES.find((profile) =>
    isSameTurnDetection(profile.turnDetection, turnDetection),
  );
  return match?.id ?? "custom";
}

export function linesToBullets(value: string): string {
  const clean = value
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[-*]\s*/, ""))
    .filter(Boolean);

  if (clean.length === 0) return "- None";
  return clean.map((line) => `- ${line}`).join("\n");
}

export function buildNaturalPhonePrompt(
  config: NaturalPresetConfig,
  direction: NaturalPromptDirection,
): string {
  const callPurpose = config.callPurpose.trim();
  const openingLine = config.openingLine.trim();
  const openingInstruction =
    direction === "inbound"
      ? openingLine
        ? [
            `- Greeting line: "${openingLine}"`,
            "- Say the greeting line as the first assistant turn, with nothing before it.",
            "- Do not mention connection status or internal call setup.",
          ].join("\n")
        : "- Start with one short, natural greeting, then listen."
      : openingLine
        ? `- After the person answers or acknowledges the call, say this naturally: "${openingLine}"`
        : "- Stay silent until the person answers, then introduce yourself briefly and ask if now is an okay time.";

  return [
    "You are a real-time AI phone agent. Sound natural, calm, and conversational.",
    "",
    "Identity:",
    `- Role: ${config.agentRole.trim() || "AI phone assistant"}`,
    config.organization.trim()
      ? `- Organization/project: ${config.organization.trim()}`
      : "",
    config.relationshipToCaller.trim()
      ? `- Relationship to the person on the phone: ${config.relationshipToCaller.trim()}`
      : "",
    "",
    "Call goal:",
    `- ${callPurpose || "Help the person on the phone with a clear, useful next step."}`,
    config.endingGoal.trim()
      ? `- Desired ending: ${config.endingGoal.trim()}`
      : "",
    "",
    "Opening:",
    openingInstruction,
    "",
    "Speaking style:",
    `- Tone: ${config.tone}`,
    `- Pacing: ${config.pacing}`,
    `- Formality: ${config.formality}`,
    "- Keep most turns to one or two short spoken sentences.",
    "- Ask one question at a time.",
    "- Acknowledge briefly before moving forward.",
    "- Do not monologue.",
    "- If interrupted, stop and respond to the person's new point.",
    "",
    config.expectedSituation.trim()
      ? `Expected situation:\n- ${config.expectedSituation.trim()}`
      : "",
    "",
    "Must ask:",
    linesToBullets(config.mustAsk),
    "",
    "Must mention:",
    linesToBullets(config.mustMention),
    "",
    "Avoid:",
    linesToBullets(config.mustAvoid),
    "",
    "Fallback behavior:",
    `- ${config.fallbackBehavior.trim() || DEFAULT_NATURAL_PRESET_CONFIG.fallbackBehavior}`,
    "",
    config.handoffInstructions.trim()
      ? `Handoff instructions:\n- ${config.handoffInstructions.trim()}`
      : "",
    "",
    config.extraInstructions.trim()
      ? `Extra instructions:\n${config.extraInstructions.trim()}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function isSameTurnDetection(a: TurnDetection, b: TurnDetection): boolean {
  return (
    a.serverVad === true &&
    b.serverVad === true &&
    Math.abs(a.threshold - b.threshold) < 0.001 &&
    a.silenceDurationMs === b.silenceDurationMs &&
    a.prefixPaddingMs === b.prefixPaddingMs
  );
}
