import "dotenv/config";
import http from "node:http";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import cors from "cors";
import express from "express";
import Stripe from "stripe";
import twilio from "twilio";
import WebSocket, { WebSocketServer } from "ws";
import {
  getBackendActor,
  getIcpServerPrincipalText,
  normalizeAnsweringPreset,
  normalizePurchaseIntent,
  normalizeReservation,
  okOrThrow,
  principalFromText,
  stripeModeToCandid,
  unwrapOptional,
} from "./ic-backend.js";

const PORT = Number(process.env.PORT || 3000);
const XAI_MODEL = process.env.XAI_MODEL || "grok-voice-think-fast-1.0";
const XAI_TTS_VOICES_URL = "https://api.x.ai/v1/tts/voices";
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const STREAM_MARK_PREFIX = "xai-audio";
const TRANSCRIPT_FINISH_GRACE_MS = 2_500;
const RECORDING_FINISH_GRACE_MS = 10_000;
const BRIDGE_RECORDING_TTL_MS = Number(
  process.env.BRIDGE_RECORDING_TTL_MS || 7 * 24 * 60 * 60 * 1000,
);
const LINE_CONFIG_REFRESH_MS = Number(process.env.LINE_CONFIG_REFRESH_MS || 30_000);
const CALL_QUEUE_MAX_WAIT_MS = Number(process.env.CALL_QUEUE_MAX_WAIT_MS || 30 * 60 * 1000);
const MAX_STEERING_PROMPT_CHARS = 800;
const MAX_INBOUND_GREETING_CHARS = 260;
const MAX_VOICE_PREVIEW_TEXT_CHARS = 220;
const VOICE_PREVIEW_TIMEOUT_MS = Number(
  process.env.VOICE_PREVIEW_TIMEOUT_MS || 12_000,
);
const VOICE_PREVIEW_RATE_LIMIT_WINDOW_MS = Number(
  process.env.VOICE_PREVIEW_RATE_LIMIT_WINDOW_MS || 60_000,
);
const VOICE_PREVIEW_RATE_LIMIT_MAX = Number(
  process.env.VOICE_PREVIEW_RATE_LIMIT_MAX || 12,
);
const SERVER_VERSION = "2026-05-31-greeting-only-openings";
const SERVER_STARTED_AT = new Date().toISOString();
const CALL_DIRECTIONS = {
  INBOUND: "inbound",
  OUTBOUND: "outbound",
};
const DEFAULT_VOICE_PREVIEW_TEXT =
  "Hello, this is a quick sample of my voice. I can sound natural, clear, and conversational on a phone call.";
const DEFAULT_XAI_VOICES = [
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

const APP_SAFETY_INSTRUCTIONS = [
  "VoiceCall AI safety policy:",
  "Do not make threats, intimidate, blackmail, extort, harass, or encourage violence.",
  "Do not provide instructions that enable malware, credential theft, fraud, evasion of security controls, weapons, explosives, poisoning, or other malicious activity.",
  "If the caller or operator asks for unsafe content, refuse briefly and redirect to a safe, lawful alternative.",
  "Never claim you will harm someone or help anyone harm someone.",
].join("\n");

const SAFETY_RULES = [
  {
    category: "threats",
    pattern:
      /\b(?:make|deliver|issue|send|say|tell|warn|promise|pretend|act|sound|convince|pressure|scare|intimidate)\b.{0,90}\b(?:threat|threaten|kill|murder|hurt|harm|injure|shoot|stab|bomb|burn|poison|kidnap|doxx?|swat|blackmail|extort)\b/i,
  },
  {
    category: "threats",
    pattern:
      /\b(?:threaten|intimidate|terrorize|blackmail|extort|doxx?|swat)\b.{0,120}\b(?:them|him|her|the caller|the recipient|customer|client|target|person|family|boss|company|with|until|unless|into)\b/i,
  },
  {
    category: "threats",
    pattern:
      /\b(?:i|we|you|the ai|the assistant|agent)\b.{0,40}\b(?:will|am going to|are going to|should|must|need to|can)\b.{0,40}\b(?:kill|murder|hurt|harm|injure|shoot|stab|bomb|burn|poison|kidnap|doxx?|swat)\b/i,
  },
  {
    category: "credential theft",
    pattern:
      /\b(?:steal|phish|exfiltrate|leak|harvest|scrape|collect)\b.{0,100}\b(?:password|credential|login|token|api key|secret key|session cookie|ssn|social security|credit card|bank account)\b/i,
  },
  {
    category: "malware",
    pattern:
      /\b(?:write|create|build|deploy|install|send|hide|obfuscate)\b.{0,100}\b(?:malware|ransomware|keylogger|spyware|trojan|worm|botnet|backdoor|credential stealer)\b/i,
  },
  {
    category: "security evasion",
    pattern:
      /\b(?:bypass|disable|evade|circumvent|break into|hack)\b.{0,100}\b(?:security|2fa|mfa|authentication|firewall|waf|rate limit|account|server|network|computer|phone)\b/i,
  },
  {
    category: "weapons or explosives",
    pattern:
      /\b(?:instructions|recipe|steps|guide|how to|make|build|synthesize|manufacture)\b.{0,100}\b(?:bomb|explosive|grenade|weapon|poison|ricin|sarin|fentanyl)\b/i,
  },
  {
    category: "fraud",
    pattern:
      /\b(?:commit|help with|run|perform|facilitate)\b.{0,100}\b(?:fraud|scam|money laundering|identity theft|carding|chargeback fraud)\b/i,
  },
];

const BILLING_PACKAGES = {
  pack_5: {
    id: "pack_5",
    name: "$5 - 45 minutes",
    amountCents: 500,
    seconds: 45 * 60,
    priceEnvSuffix: "5",
  },
  pack_10: {
    id: "pack_10",
    name: "$10 - 90 minutes",
    amountCents: 1000,
    seconds: 90 * 60,
    priceEnvSuffix: "10",
  },
  pack_20: {
    id: "pack_20",
    name: "$20 - 180 minutes",
    amountCents: 2000,
    seconds: 180 * 60,
    priceEnvSuffix: "20",
  },
};

const app = express();
app.set("trust proxy", true);

function normalizeOrigin(value) {
  const trimmed = String(value || "").trim().replace(/\/+$/, "");
  if (!trimmed || trimmed === "*") return trimmed;
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    return new URL(withProtocol).origin;
  } catch {
    return trimmed;
  }
}

function expandIcGatewayOrigins(origin) {
  const origins = [origin];
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:") return origins;
    if (url.hostname.endsWith(".icp0.io")) {
      origins.push(`https://${url.hostname.replace(/\.icp0\.io$/i, ".ic0.app")}`);
    } else if (url.hostname.endsWith(".ic0.app")) {
      origins.push(`https://${url.hostname.replace(/\.ic0\.app$/i, ".icp0.io")}`);
    }
  } catch {
    return origins;
  }
  return origins;
}

function buildAllowedOrigins() {
  const configuredOrigins = (process.env.FRONTEND_ORIGIN || "*")
    .split(",")
    .map(normalizeOrigin)
    .filter(Boolean);
  const configuredCanisterIds = (process.env.FRONTEND_CANISTER_ID || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .flatMap((id) => [`https://${id}.icp0.io`, `https://${id}.ic0.app`]);

  return new Set(
    [...configuredOrigins, ...configuredCanisterIds]
      .flatMap(expandIcGatewayOrigins)
      .map(normalizeOrigin)
      .filter(Boolean),
  );
}

const allowOrigins = buildAllowedOrigins();
const allowAllOrigins = allowOrigins.size === 0 || allowOrigins.has("*");

function isOriginAllowed(origin) {
  if (!origin || allowAllOrigins) return true;
  return allowOrigins.has(normalizeOrigin(origin));
}

app.use(
  cors({
    exposedHeaders: [
      "Accept-Ranges",
      "Content-Length",
      "Content-Range",
      "Content-Type",
    ],
    origin(origin, callback) {
      if (isOriginAllowed(origin)) {
        callback(null, true);
        return;
      }
      log("warn", "Origin not allowed by CORS", {
        origin,
        allowedOrigins: Array.from(allowOrigins),
      });
      callback(null, false);
    },
  }),
);

app.post(
  "/stripe/webhook/test",
  express.raw({ type: "application/json" }),
  stripeWebhookHandler("test"),
);
app.post(
  "/stripe/webhook/live",
  express.raw({ type: "application/json" }),
  stripeWebhookHandler("live"),
);
app.use(express.json({ limit: "256kb" }));
app.use(express.urlencoded({ extended: false }));

const requiredEnv = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "XAI_API_KEY",
];

const callSessions = new Map();
const callsBySid = new Map();
const activeLineSessions = new Map();
const bridgeRecordings = new Map();
const voicePreviewRateLimits = new Map();
const callQueue = [];
let queueProcessing = false;
let lineConfigCache = {
  numbers: null,
  fetchedAt: 0,
  pending: null,
};

const twilioClient =
  process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
    ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
    : null;
const { VoiceResponse } = twilio.twiml;

const stripeClients = new Map();

function getStripeClient(mode) {
  const keyName = mode === "test" ? "STRIPE_TEST_SECRET_KEY" : "STRIPE_LIVE_SECRET_KEY";
  const secretKey = process.env[keyName];
  if (!secretKey) {
    throw new Error(`Missing ${keyName} in the server environment.`);
  }
  if (!stripeClients.has(mode)) {
    stripeClients.set(mode, new Stripe(secretKey));
  }
  return stripeClients.get(mode);
}

function getStripeWebhookSecret(mode) {
  const keyName =
    mode === "test" ? "STRIPE_TEST_WEBHOOK_SECRET" : "STRIPE_LIVE_WEBHOOK_SECRET";
  const value = process.env[keyName];
  if (!value) {
    throw new Error(`Missing ${keyName} in the server environment.`);
  }
  return value;
}

function getStripePriceId(mode, pkg) {
  const envName = `STRIPE_${mode.toUpperCase()}_PRICE_${pkg.priceEnvSuffix}`;
  return process.env[envName] || "";
}

function getFrontendReturnBase(rawUrl) {
  const explicitReturnUrl = String(rawUrl || "").trim();
  const candidate = String(rawUrl || process.env.FRONTEND_URL || process.env.FRONTEND_ORIGIN || "")
    .split(",")[0]
    .trim();
  if (!candidate || candidate === "*") {
    throw new Error("Missing FRONTEND_URL or FRONTEND_ORIGIN for Stripe Checkout redirects.");
  }
  const normalized = explicitReturnUrl ? candidate : normalizeOrigin(candidate);
  if (!/^https?:\/\//i.test(normalized)) {
    throw new Error("Stripe return URL must be an absolute http or https URL.");
  }
  new URL(normalized);
  return normalized;
}

function centsToDollars(amountCents) {
  return (amountCents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

function log(level, message, meta = {}) {
  const entry = {
    level,
    message,
    ...meta,
    at: new Date().toISOString(),
  };
  const line = JSON.stringify(entry);
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

function hasSafetyNegationBefore(text, index) {
  const before = text.slice(Math.max(0, index - 36), index);
  return /\b(?:do not|don't|dont|never|avoid|refuse|stop|prevent|block|moderate|without|not)\b[\s.:;,-]*$/i.test(
    before,
  );
}

function findSafetyViolation(text) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return null;

  for (const rule of SAFETY_RULES) {
    const match = rule.pattern.exec(normalized);
    if (match && !hasSafetyNegationBefore(normalized, match.index)) {
      return {
        category: rule.category,
        phrase: match[0].slice(0, 120),
      };
    }
  }

  return null;
}

function assertSafeInstructionText(text, label) {
  const violation = findSafetyViolation(text);
  if (!violation) return;
  const message = `${label} was blocked by local safety checks for ${violation.category}.`;
  const error = new Error(message);
  error.code = "SAFETY_BLOCKED";
  error.category = violation.category;
  throw error;
}

function buildSafeInstructions(systemPrompt, ...extraInstructions) {
  const prompt = String(systemPrompt || "").trim();
  return [prompt, ...extraInstructions, APP_SAFETY_INSTRUCTIONS]
    .map((text) => String(text || "").trim())
    .filter(Boolean)
    .join("\n\n");
}

function normalizeSteeringPrompt(input) {
  const prompt = String(input || "").replace(/\s+/g, " ").trim();
  if (!prompt) {
    throw new Error("Enter live guidance before sending.");
  }
  if (prompt.length > MAX_STEERING_PROMPT_CHARS) {
    throw new Error(
      `Live guidance must be ${MAX_STEERING_PROMPT_CHARS} characters or fewer.`,
    );
  }
  assertSafeInstructionText(prompt, "Live guidance");
  return prompt;
}

function isWebSocketOpen(ws) {
  return ws && ws.readyState === WebSocket.OPEN;
}

function isBackendAuthorizationError(error) {
  const message = String(error?.message || error || "");
  return (
    message.includes("User is not registered") ||
    message.includes("Unauthorized: server admin only") ||
    message.includes("Only admins can assign user roles")
  );
}

function getPaymentServerAuthorizationMessage() {
  const principal = getIcpServerPrincipalText();
  return principal
    ? `Payment server principal ${principal} is not authorized in the IC backend. Open Admin Dashboard and authorize the payment server, or grant that principal the admin role.`
    : "Payment server identity is not configured. Set ICP_SERVER_IDENTITY_JSON in the voice server environment.";
}

function logPaymentServerAuthorizationFailure(action, error) {
  const principal = getIcpServerPrincipalText();
  log("error", "Payment server identity is not authorized in the IC backend", {
    action,
    principal,
    backendCanisterId: process.env.BACKEND_CANISTER_ID || "",
    error: error?.message || String(error),
    grantCommand: principal
      ? `icp canister call -e ic backend assignCallerUserRole '(principal "${principal}", variant { admin })'`
      : "",
  });
}

function getPublicHost() {
  const raw = process.env.HOSTNAME || process.env.PUBLIC_URL || "";
  if (!raw.trim()) return "";
  const withProtocol = raw.includes("://") ? raw : `https://${raw}`;
  try {
    return new URL(withProtocol).host;
  } catch {
    return raw.replace(/^https?:\/\//, "").replace(/^wss?:\/\//, "").replace(/\/.*$/, "");
  }
}

function getPublicBaseUrl() {
  const host = getPublicHost();
  return host ? `https://${host}` : "";
}

function getPublicWsUrl() {
  const host = getPublicHost();
  return host ? `wss://${host}/media` : "";
}

function getPublicRecordingStatusUrl(sessionId) {
  const publicBaseUrl = getPublicBaseUrl();
  if (!publicBaseUrl) return "";
  const url = new URL("/recording-status", publicBaseUrl);
  url.searchParams.set("sessionId", sessionId);
  return url.toString();
}

function requireTwilioConfig() {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    throw new Error("Twilio credentials are not configured.");
  }
  if (!twilioClient) {
    throw new Error("Twilio client is not configured.");
  }
}

function requireServerConfig() {
  const missing = requiredEnv.filter((key) => !process.env[key]);
  if (!process.env.BACKEND_CANISTER_ID) missing.push("BACKEND_CANISTER_ID");
  if (!process.env.ICP_SERVER_IDENTITY_JSON && !process.env.ICP_SERVER_IDENTITY_SECRET_KEY) {
    missing.push("ICP_SERVER_IDENTITY_JSON");
  }
  if (missing.length > 0) {
    throw new Error(`Missing server environment variables: ${missing.join(", ")}`);
  }
  if (!getPublicHost()) {
    throw new Error("Missing HOSTNAME. Set it to your Cloudflare Tunnel, ngrok, or deployed server host.");
  }
  if (!twilioClient) {
    throw new Error("Twilio client is not configured.");
  }
}

function requireRealtimeBridgeConfig() {
  const missing = ["XAI_API_KEY"].filter((key) => !process.env[key]);
  if (!process.env.BACKEND_CANISTER_ID) missing.push("BACKEND_CANISTER_ID");
  if (!process.env.ICP_SERVER_IDENTITY_JSON && !process.env.ICP_SERVER_IDENTITY_SECRET_KEY) {
    missing.push("ICP_SERVER_IDENTITY_JSON");
  }
  if (missing.length > 0) {
    throw new Error(`Missing server environment variables: ${missing.join(", ")}`);
  }
  if (!getPublicHost()) {
    throw new Error("Missing HOSTNAME. Set it to your Cloudflare Tunnel, ngrok, or deployed server host.");
  }
}

function normalizePhone(phone) {
  const cleaned = String(phone || "").replace(/\s/g, "");
  if (!/^\+[1-9]\d{1,14}$/.test(cleaned)) {
    throw new Error("Phone number must be E.164 format, for example +15551234567.");
  }
  return cleaned;
}

function normalizeIncomingCallerPhone(phone) {
  const cleaned = String(phone || "").replace(/\s/g, "");
  return /^\+[1-9]\d{1,14}$/.test(cleaned) ? cleaned : "unknown";
}

function parsePhoneNumberList(value) {
  return String(value || "")
    .split(/[\s,;]+/)
    .map((phone) => phone.trim())
    .filter(Boolean)
    .map(normalizePhone);
}

function uniquePhoneNumbers(numbers) {
  return Array.from(new Set(numbers.filter(Boolean)));
}

function getEnvTwilioLineNumbers() {
  const configured = [
    ...parsePhoneNumberList(process.env.TWILIO_PHONE_NUMBERS || ""),
    ...parsePhoneNumberList(process.env.TWILIO_PHONE_NUMBER || ""),
  ];
  return uniquePhoneNumbers(configured);
}

async function getConfiguredTwilioLineNumbers({ force = false } = {}) {
  const now = Date.now();
  if (
    !force &&
    lineConfigCache.numbers &&
    now - lineConfigCache.fetchedAt < LINE_CONFIG_REFRESH_MS
  ) {
    return lineConfigCache.numbers;
  }
  if (!force && lineConfigCache.pending) return lineConfigCache.pending;

  lineConfigCache.pending = (async () => {
    const envNumbers = getEnvTwilioLineNumbers();
    try {
      if (process.env.BACKEND_CANISTER_ID) {
        const actor = await getBackendActor();
        const backendNumbers = uniquePhoneNumbers(
          (await actor.getTwilioLineNumbersForServer()).map((number) =>
            normalizePhone(number),
          ),
        );
        const numbers = backendNumbers.length > 0 ? backendNumbers : envNumbers;
        lineConfigCache = { numbers, fetchedAt: Date.now(), pending: null };
        return numbers;
      }
    } catch (error) {
      log("warn", "Unable to read Twilio line config from backend", {
        error: error.message,
      });
    }
    lineConfigCache = {
      numbers: envNumbers,
      fetchedAt: Date.now(),
      pending: null,
    };
    return envNumbers;
  })();

  return lineConfigCache.pending;
}

async function getLinePoolSnapshot() {
  const numbers = await getConfiguredTwilioLineNumbers();
  const active = numbers.filter((number) => activeLineSessions.has(number));
  return {
    numbers,
    active,
    available: numbers.filter((number) => !activeLineSessions.has(number)),
    queued: getQueuedSessionIds().length,
  };
}

function normalizeVoiceIdForXai(value) {
  return String(value || "").trim();
}

function resolveVoiceId(input = {}) {
  return (
    normalizeVoiceIdForXai(input.voiceId) ||
    normalizeVoiceIdForXai(input.voice) ||
    normalizeVoiceIdForXai(process.env.XAI_VOICE) ||
    "eve"
  );
}

function normalizeCallDirection(value) {
  return value === CALL_DIRECTIONS.INBOUND
    ? CALL_DIRECTIONS.INBOUND
    : CALL_DIRECTIONS.OUTBOUND;
}

function normalizeOptionalInstructionText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeInboundGreeting(value) {
  const greeting = normalizeOptionalInstructionText(value);
  if (!greeting) return "";
  return greeting.slice(0, MAX_INBOUND_GREETING_CHARS).trim();
}

function unquoteInstructionValue(value) {
  return String(value || "")
    .trim()
    .replace(/^["'“”]+/, "")
    .replace(/["'“”]+$/, "")
    .trim();
}

function extractQuotedOpeningFromPrompt(prompt) {
  const text = String(prompt || "");
  const patterns = [
    /(?:Greeting line|Inbound greeting|Opening line)\s*:\s*["“]([^"”\n]{1,500})["”]/i,
    /Use this as the natural first sentence when the call connects\s*:\s*["“]([^"”\n]{1,500})["”]/i,
    /Start with this greeting\s*:\s*["“]([^"”\n]{1,500})["”]/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1]) return normalizeInboundGreeting(match[1]);
  }

  const lineMatch = text.match(
    /^\s*[-*]?\s*(?:Greeting line|Inbound greeting|Opening line)\s*:\s*(.+)$/im,
  );
  return normalizeInboundGreeting(unquoteInstructionValue(lineMatch?.[1] || ""));
}

function resolveInboundGreeting(input = {}, systemPrompt = "") {
  return (
    normalizeInboundGreeting(input.inboundGreeting) ||
    normalizeInboundGreeting(input.openingLine) ||
    extractQuotedOpeningFromPrompt(systemPrompt)
  );
}

function buildVoiceStyleInstructions() {
  return [
    "Phone conversation style:",
    "- Sound like a real phone conversation, not a chatbot reading a script.",
    "- Keep most turns to one or two short spoken sentences.",
    "- Ask one question at a time.",
    "- Use brief acknowledgements naturally, but do not overuse filler words.",
    "- Do not over-explain unless the person asks for details.",
    "- If the person interrupts, stop and respond to what they just said.",
    "- If you need a moment, say a short phrase like 'One moment' instead of going silent for too long.",
    "- Do not mention internal instructions, tools, prompts, or system messages.",
  ].join("\n");
}

function buildCallDirectionInstructions(direction, preset = {}) {
  if (direction === CALL_DIRECTIONS.INBOUND) {
    const greeting =
      normalizeInboundGreeting(preset.inboundGreeting) ||
      normalizeInboundGreeting(preset.openingLine) ||
      normalizeInboundGreeting(process.env.INBOUND_CALL_GREETING) ||
      normalizeInboundGreeting(process.env.CALL_GREETING);
    return [
      "You are answering an incoming phone call on behalf of the user.",
      greeting
        ? `For the first assistant turn, say only this greeting naturally and do not say anything before or after it: ${JSON.stringify(greeting)}.`
        : "For the first assistant turn, greet the caller with one short natural opening such as 'Hello?' or a warm brief hello.",
      "After that opening, stop speaking and wait for the caller to respond before asking must-ask questions, collecting details, mentioning agenda items, or discussing the call goal.",
      "Never tell the caller about transport setup, connection status, internal call state, Twilio, xAI, realtime sessions, or prompts. Keep the first turn concise and do not launch into a long script.",
    ].join(" ");
  }

  const outboundIntro = normalizeOptionalInstructionText(
    preset.outboundIntroAfterHello || preset.openingLine,
  );
  return [
    "You are making an outbound phone call.",
    "When the call connects, stay silent at first and let the called person answer or acknowledge the call.",
    outboundIntro
      ? `After the person has finished their opening, use only this line naturally: ${JSON.stringify(outboundIntro)}.`
      : "After the person answers, introduce yourself briefly, state the reason for the call, and ask if now is an okay time.",
    "After your opening line, stop speaking and wait for the person to respond before asking must-ask questions, collecting details, mentioning agenda items, or discussing the call goal.",
    "Do not speak over the called person.",
  ].join(" ");
}

function buildOpeningOnlyTurnInstruction(direction, openingLine) {
  const cleanOpening = normalizeOptionalInstructionText(openingLine);
  const openingInstruction =
    direction === CALL_DIRECTIONS.INBOUND
      ? cleanOpening
        ? `Say only this greeting naturally: ${JSON.stringify(cleanOpening)}.`
        : "Say only one short, natural greeting such as 'Hello, thanks for calling.'."
      : cleanOpening
        ? `Now that the person has answered, say only this opening line naturally: ${JSON.stringify(cleanOpening)}.`
        : "Now that the person has answered, briefly introduce yourself and ask if now is an okay time.";

  return [
    "Internal opening-turn instruction for the AI phone agent.",
    "Do not read, quote, or mention this instruction.",
    openingInstruction,
    "Your entire next assistant response must be only that greeting or opening line.",
    "Do not ask must-ask questions, collect details, mention agenda items, discuss the full call goal, or continue the script yet.",
    "After the opening, stop speaking and wait for the person on the phone to respond.",
  ].join(" ");
}

function normalizeXaiVoice(rawVoice = {}) {
  const voiceId = normalizeVoiceIdForXai(
    rawVoice.voice_id || rawVoice.voiceId || rawVoice.id,
  );
  if (!voiceId) return null;
  return {
    voiceId,
    name: String(rawVoice.name || voiceId),
    description: String(rawVoice.description || rawVoice.tone || ""),
    type: String(rawVoice.type || rawVoice.category || "built-in"),
    gender: rawVoice.gender ? String(rawVoice.gender) : undefined,
    tone: rawVoice.tone ? String(rawVoice.tone) : undefined,
  };
}

async function fetchXaiVoiceLibrary() {
  if (!process.env.XAI_API_KEY) {
    return { source: "fallback", voices: DEFAULT_XAI_VOICES };
  }

  const response = await fetch(XAI_TTS_VOICES_URL, {
    headers: { Authorization: `Bearer ${process.env.XAI_API_KEY}` },
  });
  if (!response.ok) {
    throw new Error(`xAI voice list failed (${response.status})`);
  }
  const payload = await response.json();
  const voices = Array.isArray(payload?.voices)
    ? payload.voices.map(normalizeXaiVoice).filter(Boolean)
    : [];
  return {
    source: "xai",
    voices: voices.length > 0 ? voices : DEFAULT_XAI_VOICES,
  };
}

function toPlainPreset(input = {}) {
  const turnDetection = input.turnDetection || {};
  const systemPrompt = String(
    input.systemPrompt ||
      "You are a helpful AI phone agent. Be concise, natural, and respectful.",
  );
  const openingLine = normalizeOptionalInstructionText(input.openingLine);
  const inboundGreeting = resolveInboundGreeting(input, systemPrompt);
  return {
    id: String(input.id ?? ""),
    name: String(input.name || "VoiceCall AI"),
    systemPrompt,
    openingLine: openingLine || inboundGreeting,
    inboundGreeting,
    voice: resolveVoiceId(input),
    voiceId: normalizeVoiceIdForXai(input.voiceId) || null,
    turnDetection: {
      serverVad: turnDetection.serverVad !== false,
      threshold: Number(turnDetection.threshold ?? 0.5),
      silenceDurationMs: Number(turnDetection.silenceDurationMs ?? 500),
      prefixPaddingMs: Number(turnDetection.prefixPaddingMs ?? 200),
    },
    toolsEnabled: {
      webSearch: Boolean(input.toolsEnabled?.webSearch),
      xSearch: Boolean(input.toolsEnabled?.xSearch),
      functionCalling: Boolean(input.toolsEnabled?.functionCalling),
      fileSearch: Boolean(input.toolsEnabled?.fileSearch),
    },
    vectorStoreIds: Array.isArray(input.vectorStoreIds)
      ? input.vectorStoreIds.map((id) => String(id || "").trim()).filter(Boolean)
      : [],
  };
}

function toPlainAnsweringPreset(input = {}) {
  const preset = toPlainPreset(input);
  return {
    ...preset,
    id: String(input.id ?? preset.id),
    name: String(input.name || preset.name || "AI Answering"),
    phoneNumber: String(input.phoneNumber || ""),
    captureOptions: {
      saveTranscript: Boolean(input.captureOptions?.saveTranscript),
      recordAudio: Boolean(input.captureOptions?.recordAudio),
      permissionConfirmed: Boolean(input.captureOptions?.consentConfirmed),
    },
  };
}

function normalizeCaptureOptions(input = {}) {
  const saveTranscript = Boolean(input.saveTranscript);
  const recordAudio = Boolean(input.recordAudio);
  const permissionConfirmed = Boolean(input.permissionConfirmed);
  if ((saveTranscript || recordAudio) && !permissionConfirmed) {
    throw new Error(
      "Confirm permission before saving call transcripts or recordings.",
    );
  }
  return { saveTranscript, recordAudio, permissionConfirmed };
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function buildXaiSessionUpdate(
  preset,
  { direction = CALL_DIRECTIONS.OUTBOUND } = {},
) {
  const tools = [];
  if (preset.toolsEnabled.fileSearch && preset.vectorStoreIds.length > 0) {
    tools.push({
      type: "file_search",
      vector_store_ids: preset.vectorStoreIds,
      max_num_results: 5,
    });
  }
  if (preset.toolsEnabled.webSearch) tools.push({ type: "web_search" });
  if (preset.toolsEnabled.xSearch) tools.push({ type: "x_search" });
  const callDirection = normalizeCallDirection(direction);

  return {
    type: "session.update",
    session: {
      voice: preset.voice,
      instructions: buildSafeInstructions(
        preset.systemPrompt,
        buildVoiceStyleInstructions(),
        buildCallDirectionInstructions(callDirection, preset),
      ),
      turn_detection: {
        type: "server_vad",
        threshold: clamp(preset.turnDetection.threshold, 0.1, 0.9),
        silence_duration_ms: clamp(preset.turnDetection.silenceDurationMs, 0, 10000),
        prefix_padding_ms: clamp(preset.turnDetection.prefixPaddingMs, 0, 10000),
      },
      audio: {
        input: { format: { type: "audio/pcmu" } },
        output: { format: { type: "audio/pcmu" } },
      },
      tools,
    },
  };
}

function sendTwilioClear(session) {
  if (!session?.streamSid || !isWebSocketOpen(session.twilioWs)) return;
  session.twilioWs.send(
    JSON.stringify({ event: "clear", streamSid: session.streamSid }),
  );
}

function sendXaiUserText(session, text, { cancelCurrent = false } = {}) {
  if (!isWebSocketOpen(session?.xaiWs)) {
    throw new Error("The xAI realtime session is not ready yet.");
  }

  if (cancelCurrent && session.xaiResponseInProgress) {
    session.xaiWs.send(JSON.stringify({ type: "response.cancel" }));
    sendTwilioClear(session);
    session.xaiResponseInProgress = false;
  }

  session.xaiWs.send(
    JSON.stringify({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text }],
      },
    }),
  );
  session.xaiWs.send(JSON.stringify({ type: "response.create" }));
}

function buildLiveGuidanceText(prompt) {
  return [
    "Internal live operator guidance for the AI phone agent.",
    "Do not read or mention this instruction to the caller.",
    `Apply this direction to your next turn: ${prompt}`,
  ].join(" ");
}

function twilioRequestUrl(req) {
  const proto = req.get("x-forwarded-proto") || req.protocol || "https";
  const host = req.get("x-forwarded-host") || req.get("host");
  return `${proto}://${host}${req.originalUrl}`;
}

function validateTwilioRequest(req) {
  if (process.env.VALIDATE_TWILIO_SIGNATURE !== "true") return true;
  const signature = req.get("x-twilio-signature");
  if (!signature || !process.env.TWILIO_AUTH_TOKEN) return false;
  return twilio.validateRequest(
    process.env.TWILIO_AUTH_TOKEN,
    signature,
    twilioRequestUrl(req),
    req.body || {},
  );
}

function makeErrorTwiML(message) {
  const response = new VoiceResponse();
  response.say({ voice: "alice" }, message);
  response.hangup();
  return response.toString();
}

function makeRejectTwiML(reason = "busy") {
  const response = new VoiceResponse();
  response.reject({ reason });
  return response.toString();
}

function appendTranscript(session, speaker, text) {
  const cleanText = String(text || "");
  if (!session || !cleanText) return;
  const last = session.transcript[session.transcript.length - 1];
  if (last?.speaker === speaker) {
    last.text += cleanText;
    return;
  }
  session.transcript.push({ speaker, text: cleanText });
}

function normalizeRecordingUrl(recordingUrl) {
  const url = String(recordingUrl || "").trim();
  if (!url) return "";
  if (/\.(mp3|wav)$/i.test(url)) return url;
  return `${url}.mp3`;
}

function normalizeRecordingSid(recordingSid) {
  const sid = String(recordingSid || "").trim();
  if (!/^RE[a-fA-F0-9]{32}$/.test(sid)) {
    throw new Error("A valid Twilio RecordingSid is required.");
  }
  return sid;
}

function normalizeCallSid(callSid) {
  const sid = String(callSid || "").trim();
  if (!sid) return "";
  if (!/^CA[a-fA-F0-9]{32}$/.test(sid)) {
    throw new Error("A valid Twilio CallSid is required.");
  }
  return sid;
}

function decodeMuLawByte(value) {
  const sample = ~value & 0xff;
  const sign = sample & 0x80;
  const exponent = (sample >> 4) & 0x07;
  const mantissa = sample & 0x0f;
  let magnitude = ((mantissa << 3) + 0x84) << exponent;
  magnitude -= 0x84;
  return sign ? -magnitude : magnitude;
}

function buildPcmWavFromMuLaw(chunks) {
  const totalSamples = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const dataSize = totalSamples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(8000, 24);
  buffer.writeUInt32LE(8000 * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  let offset = 44;
  for (const chunk of chunks) {
    for (const value of chunk) {
      const sample = Math.max(-32768, Math.min(32767, decodeMuLawByte(value)));
      buffer.writeInt16LE(sample, offset);
      offset += 2;
    }
  }
  return buffer;
}

function requireXaiConfig() {
  if (!process.env.XAI_API_KEY) {
    throw new Error("xAI API key is not configured.");
  }
}

function normalizeVoicePreviewVoiceId(value) {
  const voiceId = normalizeVoiceIdForXai(value);
  if (!voiceId) {
    throw new Error("voiceId is required.");
  }
  if (voiceId.length > 80 || !/^[A-Za-z0-9_-]+$/.test(voiceId)) {
    throw new Error(
      "Voice ID can only contain letters, numbers, dashes, and underscores.",
    );
  }
  return voiceId;
}

function normalizeVoicePreviewText(value) {
  const text = String(value || DEFAULT_VOICE_PREVIEW_TEXT)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_VOICE_PREVIEW_TEXT_CHARS);
  assertSafeInstructionText(text, "Voice preview text");
  return text || DEFAULT_VOICE_PREVIEW_TEXT;
}

function assertVoicePreviewRateLimit(req) {
  const key =
    String(req.get("x-forwarded-for") || "")
      .split(",")[0]
      .trim() ||
    req.ip ||
    "unknown";
  const now = Date.now();
  const existing = voicePreviewRateLimits.get(key);
  if (!existing || existing.resetAt <= now) {
    voicePreviewRateLimits.set(key, {
      count: 1,
      resetAt: now + VOICE_PREVIEW_RATE_LIMIT_WINDOW_MS,
    });
    return;
  }
  if (existing.count >= VOICE_PREVIEW_RATE_LIMIT_MAX) {
    const error = new Error("Too many voice previews. Please wait a moment and try again.");
    error.statusCode = 429;
    throw error;
  }
  existing.count += 1;
}

function buildVoicePreviewSessionUpdate(voiceId) {
  return {
    type: "session.update",
    session: {
      voice: voiceId,
      instructions: buildSafeInstructions(
        [
          "You are generating a short voice sample for a user choosing an AI phone voice.",
          "Read the sample text naturally, clearly, and conversationally.",
          "Do not add extra words before or after the sample.",
        ].join(" "),
      ),
      turn_detection: {
        type: "server_vad",
        threshold: 0.5,
        silence_duration_ms: 500,
        prefix_padding_ms: 200,
      },
      audio: {
        input: { format: { type: "audio/pcmu" } },
        output: { format: { type: "audio/pcmu" } },
      },
      tools: [],
    },
  };
}

function generateVoicePreviewAudio({ voiceId, text }) {
  requireXaiConfig();
  return new Promise((resolve, reject) => {
    const audioChunks = [];
    let settled = false;
    let previewRequested = false;
    const ws = new WebSocket(
      `wss://api.x.ai/v1/realtime?model=${encodeURIComponent(XAI_MODEL)}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.XAI_API_KEY}`,
        },
      },
    );

    let timeout = null;
    const settle = (error, wavBuffer) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (
        ws.readyState === WebSocket.OPEN ||
        ws.readyState === WebSocket.CONNECTING
      ) {
        ws.close();
      }
      if (error) {
        reject(error);
        return;
      }
      resolve(wavBuffer);
    };

    timeout = setTimeout(() => {
      settle(new Error("Voice preview timed out."));
    }, clamp(VOICE_PREVIEW_TIMEOUT_MS, 3_000, 20_000));
    timeout.unref?.();

    const requestPreviewAudio = () => {
      if (previewRequested || !isWebSocketOpen(ws)) return;
      previewRequested = true;
      ws.send(
        JSON.stringify({
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text }],
          },
        }),
      );
      ws.send(JSON.stringify({ type: "response.create" }));
    };

    ws.on("open", () => {
      ws.send(JSON.stringify(buildVoicePreviewSessionUpdate(voiceId)));
      const fallbackTimer = setTimeout(requestPreviewAudio, 350);
      fallbackTimer.unref?.();
    });

    ws.on("message", (raw) => {
      let event;
      try {
        event = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (event.type === "session.updated") {
        requestPreviewAudio();
        return;
      }

      if (event.type === "response.output_audio.delta" && event.delta) {
        audioChunks.push(Buffer.from(event.delta, "base64"));
        return;
      }

      if (event.type === "response.done") {
        if (audioChunks.length === 0) {
          settle(new Error("Voice preview returned no audio."));
          return;
        }
        settle(null, buildPcmWavFromMuLaw(audioChunks));
        return;
      }

      if (event.type === "error") {
        settle(
          new Error(
            event.error?.message || event.message || "Voice preview failed.",
          ),
        );
      }
    });

    ws.on("error", (error) => settle(error));
    ws.on("close", () => {
      if (!settled) settle(new Error("Voice preview connection closed."));
    });
  });
}

function getBridgeRecordingAccessSecret() {
  return (
    process.env.BRIDGE_RECORDING_ACCESS_SECRET ||
    process.env.RECORDING_ACCESS_SECRET ||
    process.env.ICP_SERVER_IDENTITY_SECRET_KEY ||
    process.env.XAI_API_KEY ||
    ""
  );
}

function signBridgeRecordingAccess(recordingId) {
  const secret = getBridgeRecordingAccessSecret();
  if (!secret) {
    throw new Error("Bridge recording access secret is not configured.");
  }
  return crypto.createHmac("sha256", secret).update(recordingId).digest("base64url");
}

function buildPublicBridgeRecordingUrl(recordingId) {
  const publicBaseUrl = getPublicBaseUrl();
  if (!publicBaseUrl) {
    throw new Error("Missing HOSTNAME. Recording playback requires a public voice server URL.");
  }
  const url = new URL(`/bridge-recordings/${recordingId}`, publicBaseUrl);
  url.searchParams.set("token", signBridgeRecordingAccess(recordingId));
  return url.toString();
}

function appendBridgeRecordingAudio(session, payload) {
  if (
    !session?.recordAudio ||
    !session.permissionConfirmed ||
    session.recordingMode !== "bridge" ||
    !payload
  ) {
    return;
  }
  if (!session.bridgeRecordingChunks) session.bridgeRecordingChunks = [];
  session.bridgeRecordingChunks.push(Buffer.from(payload, "base64"));
}

function finalizeBridgeRecording(session) {
  if (
    !session?.recordAudio ||
    !session.permissionConfirmed ||
    session.recordingMode !== "bridge" ||
    session.recording?.url
  ) {
    return;
  }
  const chunks = session.bridgeRecordingChunks || [];
  if (chunks.length === 0) {
    session.recording = {
      sid: null,
      callSid: session.callSid || null,
      url: null,
      sourceUrl: null,
      status: "absent",
      duration: null,
    };
    return;
  }

  const recordingId = `br_${session.id}`;
  const media = buildPcmWavFromMuLaw(chunks);
  bridgeRecordings.set(recordingId, {
    media,
    callSid: session.callSid || "",
    createdAt: Date.now(),
    expiresAt: Date.now() + BRIDGE_RECORDING_TTL_MS,
  });
  session.recording = {
    sid: null,
    callSid: session.callSid || null,
    url: buildPublicBridgeRecordingUrl(recordingId),
    sourceUrl: null,
    status: "completed",
    duration: session.billingStartedAt
      ? String(Math.max(0, Math.ceil(((session.billingStoppedAt || Date.now()) - session.billingStartedAt) / 1000)))
      : null,
  };
  session.bridgeRecordingChunks = [];
}

function getRecordingAccessSecret() {
  return (
    process.env.RECORDING_ACCESS_SECRET ||
    process.env.TWILIO_AUTH_TOKEN ||
    process.env.ICP_SERVER_IDENTITY_SECRET_KEY ||
    ""
  );
}

function signRecordingAccess(recordingSid, callSid = "") {
  const secret = getRecordingAccessSecret();
  if (!secret) {
    throw new Error("Recording access secret is not configured.");
  }
  return crypto
    .createHmac("sha256", secret)
    .update(`${recordingSid}:${callSid}`)
    .digest("base64url");
}

function isRecordingAccessTokenValid(recordingSid, callSid, token) {
  const supplied = String(token || "").trim();
  if (!supplied) return false;
  const expected = signRecordingAccess(recordingSid, callSid);
  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  return (
    suppliedBytes.length === expectedBytes.length &&
    crypto.timingSafeEqual(suppliedBytes, expectedBytes)
  );
}

function buildPublicRecordingMediaUrl(recordingSid, callSid = "") {
  const publicBaseUrl = getPublicBaseUrl();
  if (!publicBaseUrl) {
    throw new Error(
      "Missing HOSTNAME. Recording playback requires a public voice server URL.",
    );
  }
  const url = new URL(`/recordings/${recordingSid}`, publicBaseUrl);
  if (callSid) url.searchParams.set("callSid", callSid);
  url.searchParams.set("token", signRecordingAccess(recordingSid, callSid));
  return url.toString();
}

function buildTwilioRecordingMediaUrl(recordingSid, format = "mp3") {
  return `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(
    process.env.TWILIO_ACCOUNT_SID,
  )}/Recordings/${encodeURIComponent(recordingSid)}.${format}`;
}

function getTwilioBasicAuthHeader() {
  return `Basic ${Buffer.from(
    `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`,
  ).toString("base64")}`;
}

function updateSessionRecordingFromBody(session, body = {}) {
  if (!session?.recordAudio) return;
  const twilioRecordingUrl = normalizeRecordingUrl(body.RecordingUrl);
  const rawRecordingSid = String(body.RecordingSid || "").trim();
  const recordingSid = /^RE[a-fA-F0-9]{32}$/.test(rawRecordingSid)
    ? rawRecordingSid
    : "";
  const callSid = String(
    body.CallSid || session.recording?.callSid || session.callSid || "",
  ).trim();
  const recordingStatus = String(body.RecordingStatus || "").trim();
  if (!twilioRecordingUrl && !recordingSid && !recordingStatus) return;
  const statusLower = recordingStatus.toLowerCase();
  const isPlayableStatus = !recordingStatus || statusLower === "completed";
  const appRecordingUrl =
    recordingSid && isPlayableStatus
      ? buildPublicRecordingMediaUrl(recordingSid, callSid)
      : "";
  const fallbackRecordingUrl = isPlayableStatus ? twilioRecordingUrl : "";
  session.recording = {
    sid: recordingSid || session.recording?.sid || null,
    callSid: callSid || session.recording?.callSid || null,
    url: appRecordingUrl || session.recording?.url || fallbackRecordingUrl || null,
    sourceUrl: twilioRecordingUrl || session.recording?.sourceUrl || null,
    status: recordingStatus || session.recording?.status || null,
    duration: body.RecordingDuration
      ? String(body.RecordingDuration)
      : session.recording?.duration || null,
  };
}

function broadcastMonitorEvent(session, payload) {
  if (!session?.monitorClients?.size) return;
  const message = JSON.stringify(payload);
  for (const client of session.monitorClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    } else {
      session.monitorClients.delete(client);
    }
  }
}

function broadcastMonitorAudio(session, channel, payload) {
  if (!payload) return;
  broadcastMonitorEvent(session, {
    type: "audio",
    channel,
    codec: "audio/pcmu",
    sampleRate: 8000,
    payload,
    at: Date.now(),
  });
}

function getSessionFromRequest(req) {
  const sessionId = String(req.query.sessionId || req.body.sessionId || "");
  return { sessionId, session: callSessions.get(sessionId) };
}

async function getPurchaseIntentOrThrow(purchaseIntentId) {
  const actor = await getBackendActor();
  let optionalIntent;
  try {
    optionalIntent = await actor.getPurchaseIntentForServer(purchaseIntentId);
  } catch (error) {
    if (isBackendAuthorizationError(error)) {
      logPaymentServerAuthorizationFailure("getPurchaseIntentForServer", error);
      throw new Error(getPaymentServerAuthorizationMessage());
    }
    throw error;
  }
  const intent = normalizePurchaseIntent(unwrapOptional(optionalIntent));
  if (!intent) {
    throw new Error("Purchase intent not found.");
  }
  return intent;
}

async function createCheckoutSession({ purchaseIntentId, returnUrl }) {
  const intent = await getPurchaseIntentOrThrow(purchaseIntentId);
  if (intent.status !== "pending") {
    throw new Error("This purchase intent is no longer pending.");
  }

  const pkg = BILLING_PACKAGES[intent.packageId];
  if (!pkg) {
    throw new Error("Unknown billing package.");
  }
  if (pkg.amountCents !== intent.amountCents || pkg.seconds !== intent.seconds) {
    throw new Error("Billing package details do not match the purchase intent.");
  }

  const stripe = getStripeClient(intent.mode);
  const priceId = getStripePriceId(intent.mode, pkg);
  const returnBase = getFrontendReturnBase(returnUrl);
  const successUrl = new URL(returnBase);
  successUrl.searchParams.set("billing", "success");
  successUrl.searchParams.set("session_id", "{CHECKOUT_SESSION_ID}");
  const cancelUrl = new URL(returnBase);
  cancelUrl.searchParams.set("billing", "canceled");

  const metadata = {
    purchaseIntentId: intent.id,
    principal: intent.user,
    packageId: intent.packageId,
    seconds: String(intent.seconds),
    mode: intent.mode,
  };

  const lineItem = priceId
    ? { price: priceId, quantity: 1 }
    : {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: intent.amountCents,
          product_data: {
            name: `VoiceCall AI phone time: ${Math.floor(intent.seconds / 60)} minutes`,
            description: `${centsToDollars(intent.amountCents)} prepaid AI phone time`,
          },
        },
      };

  return stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [lineItem],
    success_url: successUrl.toString(),
    cancel_url: cancelUrl.toString(),
    metadata,
    payment_intent_data: { metadata },
  });
}

async function fulfillCheckoutSession(session, mode) {
  if (!session?.id) return;
  if (session.payment_status !== "paid") {
    log("info", "Ignoring unpaid Checkout Session", {
      sessionId: session.id,
      paymentStatus: session.payment_status,
      mode,
    });
    return;
  }

  const purchaseIntentId = session.metadata?.purchaseIntentId;
  const principal = session.metadata?.principal;
  const seconds = Number(session.metadata?.seconds || 0);
  const sessionMode = session.metadata?.mode || mode;
  if (!purchaseIntentId || !principal || !Number.isFinite(seconds) || seconds <= 0) {
    throw new Error("Checkout Session metadata is incomplete.");
  }
  if (sessionMode !== mode) {
    throw new Error("Checkout Session mode does not match the webhook endpoint.");
  }

  const actor = await getBackendActor();
  let result;
  try {
    result = await actor.creditPaidSeconds(
      session.id,
      purchaseIntentId,
      principalFromText(principal),
      BigInt(seconds),
      stripeModeToCandid(mode),
    );
  } catch (error) {
    if (isBackendAuthorizationError(error)) {
      logPaymentServerAuthorizationFailure("creditPaidSeconds", error);
      throw new Error(getPaymentServerAuthorizationMessage());
    }
    throw error;
  }
  okOrThrow(result, "Unable to credit paid phone time.");
  log("info", "Credited paid phone time", {
    sessionId: session.id,
    purchaseIntentId,
    principal,
    seconds,
    mode,
  });
}

function stripeWebhookHandler(mode) {
  return async (req, res) => {
    try {
      const stripe = getStripeClient(mode);
      const signature = req.get("stripe-signature");
      const event = stripe.webhooks.constructEvent(
        req.body,
        signature,
        getStripeWebhookSecret(mode),
      );

      if (
        event.type === "checkout.session.completed" ||
        event.type === "checkout.session.async_payment_succeeded"
      ) {
        await fulfillCheckoutSession(event.data.object, mode);
      }

      res.json({ received: true });
    } catch (error) {
      log("error", "Stripe webhook failed", { mode, error: error.message });
      res.status(400).send(`Webhook Error: ${error.message}`);
    }
  };
}

function callArtifactsToText(session) {
  if (!session) return null;
  const sections = [];
  if (session.saveTranscript && session.permissionConfirmed && session.transcript?.length) {
    const transcript = session.transcript
      .map((entry) => {
        const text = String(entry.text || "").trim();
        return text ? `${entry.speaker}: ${text}` : "";
      })
      .filter(Boolean)
      .join("\n");
    if (transcript) sections.push(transcript);
  }

  if (session.recordAudio && session.permissionConfirmed) {
    const recordingLines = ["Recording: enabled"];
    if (session.recording?.url) {
      recordingLines.push(`Recording URL: ${session.recording.url}`);
    }
    if (session.recording?.sid) {
      recordingLines.push(`Recording SID: ${session.recording.sid}`);
    }
    if (!session.recording?.url) {
      recordingLines.push("Recording URL: pending");
    }
    sections.push(recordingLines.join("\n"));
  }

  const text = sections.join("\n\n").trim();
  return text ? text.slice(0, 20_000) : null;
}

async function finishPaidSession(session, reason = "completed") {
  if (!session || session.finished) return;
  if (session.state === "queued" && !session.callSid) {
    await cancelQueuedSession(session, reason);
    return;
  }
  session.finished = true;
  session.billingFinishedAt = session.billingStoppedAt || Date.now();
  removeQueuedSession(session.id);
  if (session.cutoffTimer) {
    clearTimeout(session.cutoffTimer);
    session.cutoffTimer = null;
  }
  if (session.finishTimer) {
    clearTimeout(session.finishTimer);
    session.finishTimer = null;
  }

  const usedSeconds = session.billingStartedAt
    ? Math.ceil((session.billingFinishedAt - session.billingStartedAt) / 1000)
    : 0;
  finalizeBridgeRecording(session);
  const artifactsText = callArtifactsToText(session);

  if (session.reservationId) {
    try {
      const actor = await getBackendActor();
      okOrThrow(
        await actor.finishCallAndDebit(
          session.reservationId,
          BigInt(Math.max(0, usedSeconds)),
          session.callSid ? [session.callSid] : [],
          artifactsText ? [artifactsText] : [],
        ),
        "Unable to finish and debit paid call.",
      );
      log("info", "Finished paid call session", {
        sessionId: session.id,
        reservationId: session.reservationId,
        callSid: session.callSid,
        usedSeconds,
        reason,
        naturalness: buildNaturalnessMetricSummary(session),
      });
    } catch (error) {
      log("error", "Failed to finish paid call session", {
        sessionId: session.id,
        reservationId: session.reservationId,
        error: error.message,
      });
    }
  }

  if (session.answeringPresetId) {
    try {
      const actor = await getBackendActor();
      await actor.finishAnsweringLiveSessionForServer(session.id);
    } catch (error) {
      log("warn", "Unable to clear answering live session", {
        sessionId: session.id,
        error: error.message,
      });
    }
  }

  broadcastMonitorEvent(session, { type: "ended", reason });
  for (const client of session.monitorClients || []) {
    if (client.readyState === WebSocket.OPEN) client.close(1000, "Call ended");
  }
  releaseSessionLine(session);
  callSessions.delete(session.id);
  if (session.callSid) callsBySid.delete(session.callSid);
}

function scheduleFinishPaidSession(session, reason = "completed") {
  if (!session || session.finished) return;
  session.billingStoppedAt ||= Date.now();
  const recordingStatus = String(session.recording?.status || "").toLowerCase();
  const waitingForRecording =
    session.recordAudio &&
    session.permissionConfirmed &&
    !session.recording?.url &&
    !["completed", "absent"].includes(recordingStatus);
  const waitingForTranscript =
    session.saveTranscript && session.permissionConfirmed && session.awaitingCallerTranscript;
  if (waitingForRecording || waitingForTranscript) {
    if (!session.finishTimer) {
      session.deferredFinishReason = reason;
      session.finishTimer = setTimeout(() => {
        finishPaidSession(session, session.deferredFinishReason || reason);
      }, waitingForRecording ? RECORDING_FINISH_GRACE_MS : TRANSCRIPT_FINISH_GRACE_MS);
      session.finishTimer.unref?.();
    }
    return;
  }
  finishPaidSession(session, reason);
}

function startBillingTimer(session, closeBoth) {
  if (!session || session.billingStartedAt) return;
  session.billingStartedAt = Date.now();
  const allowedSeconds = Math.max(1, Number(session.allowedSeconds || 1));
  session.cutoffTimer = setTimeout(async () => {
    log("info", "Paid call time exhausted", {
      sessionId: session.id,
      reservationId: session.reservationId,
      callSid: session.callSid,
      allowedSeconds,
    });
    try {
      if (session.callSid && twilioClient) {
        await twilioClient.calls(session.callSid).update({ status: "completed" });
      }
    } catch (error) {
      log("warn", "Unable to end Twilio call at paid-time cutoff", {
        callSid: session.callSid,
        error: error.message,
      });
    }
    session.billingStoppedAt ||= Date.now();
    closeBoth();
    await finishPaidSession(session, "paid_time_exhausted");
  }, allowedSeconds * 1000);
  session.cutoffTimer.unref?.();
}

function isTerminalTwilioStatus(status) {
  return ["completed", "failed", "busy", "no-answer", "canceled"].includes(
    String(status || "").toLowerCase(),
  );
}

function getQueuedSessionIds() {
  return callQueue.filter((sessionId) => {
    const session = callSessions.get(sessionId);
    return session && !session.finished && session.state === "queued";
  });
}

function getQueuePosition(sessionId) {
  const queued = getQueuedSessionIds();
  const index = queued.indexOf(sessionId);
  return index === -1 ? 0 : index + 1;
}

function removeQueuedSession(sessionId) {
  for (let i = callQueue.length - 1; i >= 0; i -= 1) {
    if (callQueue[i] === sessionId) callQueue.splice(i, 1);
  }
}

function enqueueCallSession(session) {
  if (!session || session.finished) return;
  session.state = "queued";
  session.queueEnteredAt ||= Date.now();
  if (!callQueue.includes(session.id)) callQueue.push(session.id);
}

async function getAvailableLineNumber() {
  const numbers = await getConfiguredTwilioLineNumbers();
  return numbers.find((number) => !activeLineSessions.has(number)) || "";
}

function assignLineToSession(session, lineNumber) {
  session.lineNumber = lineNumber;
  activeLineSessions.set(lineNumber, session.id);
}

function releaseSessionLine(session) {
  const lineNumber = session?.lineNumber;
  if (!lineNumber) return;
  if (activeLineSessions.get(lineNumber) === session.id) {
    activeLineSessions.delete(lineNumber);
  }
  session.lineNumber = null;
  setTimeout(() => {
    dispatchQueuedSessions().catch((error) => {
      log("error", "Queued call dispatch failed", { error: error.message });
    });
  }, 0).unref?.();
}

function getSessionStatus(session) {
  if (session?.finished) return "completed";
  const lastStatus = String(session?.lastStatus || "").toLowerCase();
  if (isTerminalTwilioStatus(lastStatus)) return lastStatus;
  return session?.state || (session?.callSid ? "active" : "queued");
}

function buildCallSessionPayload(session) {
  return {
    ok: true,
    sessionId: session.id,
    callSid: session.callSid || "",
    monitorToken: session.monitorToken || "",
    status: getSessionStatus(session),
    queued: session.state === "queued",
    queuePosition: getQueuePosition(session.id),
    allowedSeconds: session.allowedSeconds,
    liveAudio: session.callSid
      ? {
          codec: "audio/pcmu",
          sampleRate: 8000,
        }
      : null,
  };
}

function createNaturalnessMetrics() {
  return {
    streamStartedAt: null,
    firstAssistantAudioAt: null,
    assistantTurns: 0,
    callerSpeechStarts: 0,
    bargeInCount: 0,
    assistantAudioChunks: 0,
    assistantTranscriptChars: 0,
    callerTranscriptChars: 0,
  };
}

function buildNaturalnessMetricSummary(session) {
  const metrics = session?.metrics;
  if (!metrics) return null;
  const firstAssistantLatencyMs =
    metrics.firstAssistantAudioAt && metrics.streamStartedAt
      ? metrics.firstAssistantAudioAt - metrics.streamStartedAt
      : null;
  return {
    firstAssistantLatencyMs,
    assistantTurns: metrics.assistantTurns,
    callerSpeechStarts: metrics.callerSpeechStarts,
    bargeInCount: metrics.bargeInCount,
    assistantTranscriptChars: metrics.assistantTranscriptChars,
    callerTranscriptChars: metrics.callerTranscriptChars,
  };
}

async function cancelQueuedSession(session, reason = "queued_call_canceled") {
  if (!session || session.finished) return;
  removeQueuedSession(session.id);
  session.finished = true;
  session.state = "canceled";
  session.billingStoppedAt ||= Date.now();
  if (session.reservationId) {
    try {
      const actor = await getBackendActor();
      await actor.cancelCallReservation(session.reservationId, reason);
    } catch (error) {
      log("warn", "Unable to cancel queued reservation", {
        sessionId: session.id,
        reservationId: session.reservationId,
        error: error.message,
      });
    }
  }
  broadcastMonitorEvent(session, { type: "ended", reason });
  callSessions.delete(session.id);
}

async function createTwilioCallForSession(session, lineNumber, actor) {
  if (!lineNumber) return null;
  if (!session || session.finished) return null;

  session.state = "dialing";
  assignLineToSession(session, lineNumber);

  try {
    const callCreateOptions = {
      to: session.recipientPhone,
      from: lineNumber,
      url: session.twimlUrl,
      method: "POST",
      statusCallback: session.statusCallbackUrl,
      statusCallbackMethod: "POST",
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
    };
    if (session.recordAudio) {
      callCreateOptions.record = true;
      callCreateOptions.recordingTrack = "both";
      callCreateOptions.recordingChannels = "dual";
      callCreateOptions.recordingStatusCallback = session.recordingStatusUrl;
      callCreateOptions.recordingStatusCallbackMethod = "POST";
      callCreateOptions.recordingStatusCallbackEvent = [
        "in-progress",
        "completed",
        "absent",
      ];
    }

    const call = await twilioClient.calls.create(callCreateOptions);

    session.callSid = call.sid;
    session.state = "active";
    callsBySid.set(call.sid, session.id);
    okOrThrow(
      await actor.markReservationStarted(session.reservationId, call.sid),
      "Unable to mark paid reservation as started.",
    );
    log("info", "Twilio call created", {
      callSid: call.sid,
      callId: session.callId,
      sessionId: session.id,
      lineNumber,
    });
    return call;
  } catch (error) {
    if (session.callSid && twilioClient) {
      try {
        await twilioClient.calls(session.callSid).update({ status: "completed" });
      } catch (endError) {
        log("warn", "Unable to end failed Twilio call during dispatch", {
          callSid: session.callSid,
          error: endError.message,
        });
      }
      callsBySid.delete(session.callSid);
      session.callSid = null;
    }
    releaseSessionLine(session);
    session.state = "failed";
    throw error;
  }
}

async function dispatchQueuedSessions() {
  if (queueProcessing) return;
  queueProcessing = true;
  try {
    while (callQueue.length > 0) {
      const sessionId = callQueue[0];
      const session = callSessions.get(sessionId);
      if (!session || session.finished || session.state !== "queued") {
        callQueue.shift();
        continue;
      }

      if (Date.now() - session.queueEnteredAt > CALL_QUEUE_MAX_WAIT_MS) {
        callQueue.shift();
        await cancelQueuedSession(
          session,
          "No Twilio line became available before the queue timeout.",
        );
        continue;
      }

      const lineNumber = await getAvailableLineNumber();
      if (!lineNumber) break;

      callQueue.shift();
      try {
        const actor = await getBackendActor();
        await createTwilioCallForSession(session, lineNumber, actor);
      } catch (error) {
        log("error", "Unable to dispatch queued call", {
          sessionId,
          error: error.message,
        });
        await cancelQueuedSession(session, error.message);
      }
    }
  } finally {
    queueProcessing = false;
  }
}

app.get("/health", async (_req, res) => {
  const linePool = await getLinePoolSnapshot().catch((error) => ({
    numbers: getEnvTwilioLineNumbers(),
    active: [],
    available: [],
    queued: getQueuedSessionIds().length,
    error: error.message,
  }));
  res.json({
    ok: true,
    serverVersion: SERVER_VERSION,
    startedAt: SERVER_STARTED_AT,
    publicHost: getPublicHost(),
    cors: {
      allowAllOrigins,
      allowedOrigins: Array.from(allowOrigins),
    },
    twilioConfigured: Boolean(
      process.env.TWILIO_ACCOUNT_SID &&
        process.env.TWILIO_AUTH_TOKEN &&
        linePool.numbers.length > 0,
    ),
    twilioLines: {
      configured: linePool.numbers.length,
      active: linePool.active.length,
      available: linePool.available.length,
      queued: linePool.queued,
      numbers: linePool.numbers,
    },
    xaiConfigured: Boolean(process.env.XAI_API_KEY),
    answeringBridgeConfigured: Boolean(
      process.env.XAI_API_KEY &&
        process.env.BACKEND_CANISTER_ID &&
        (process.env.ICP_SERVER_IDENTITY_JSON || process.env.ICP_SERVER_IDENTITY_SECRET_KEY) &&
        getPublicHost(),
    ),
    billingConfigured: Boolean(
      process.env.BACKEND_CANISTER_ID &&
        (process.env.ICP_SERVER_IDENTITY_JSON || process.env.ICP_SERVER_IDENTITY_SECRET_KEY) &&
        process.env.STRIPE_TEST_SECRET_KEY &&
        process.env.STRIPE_TEST_WEBHOOK_SECRET &&
        process.env.STRIPE_LIVE_SECRET_KEY &&
        process.env.STRIPE_LIVE_WEBHOOK_SECRET,
    ),
    backendCanisterId: process.env.BACKEND_CANISTER_ID || "",
    backendHost: process.env.BACKEND_HOST || "https://icp-api.io",
    icpServerPrincipal: getIcpServerPrincipalText(),
    model: XAI_MODEL,
  });
});

app.get("/xai/voices", async (_req, res) => {
  try {
    const library = await fetchXaiVoiceLibrary();
    res.json({ ok: true, ...library });
  } catch (error) {
    log("warn", "Unable to fetch xAI voice library", {
      error: error.message,
    });
    res.json({
      ok: true,
      source: "fallback",
      voices: DEFAULT_XAI_VOICES,
      warning: error.message,
    });
  }
});

app.post("/xai/voice-preview", async (req, res) => {
  try {
    assertVoicePreviewRateLimit(req);
    const voiceId = normalizeVoicePreviewVoiceId(req.body?.voiceId);
    const text = normalizeVoicePreviewText(req.body?.text);
    const wavBuffer = await generateVoicePreviewAudio({ voiceId, text });
    res.json({
      ok: true,
      voiceId,
      contentType: "audio/wav",
      audioBase64: wavBuffer.toString("base64"),
    });
  } catch (error) {
    const status =
      error.statusCode || (error.code === "SAFETY_BLOCKED" ? 400 : 500);
    log(status >= 500 ? "error" : "warn", "Voice preview failed", {
      voiceId: req.body?.voiceId,
      error: error.message,
      category: error.category,
    });
    res.status(status).json({ ok: false, error: error.message });
  }
});

app.get("/recordings/:recordingSid/access", async (req, res) => {
  try {
    requireTwilioConfig();
    const recordingSid = normalizeRecordingSid(req.params.recordingSid);
    const callSid = normalizeCallSid(req.query.callSid);

    if (callSid) {
      const recording = await twilioClient.recordings(recordingSid).fetch();
      const recordingCallSid = String(
        recording.callSid || recording.call_sid || "",
      );
      if (recordingCallSid && recordingCallSid !== callSid) {
        throw new Error("Recording does not belong to this call.");
      }
    }

    res.json({
      ok: true,
      url: buildPublicRecordingMediaUrl(recordingSid, callSid),
    });
  } catch (error) {
    log("error", "Failed to create recording access URL", {
      recordingSid: req.params.recordingSid,
      error: error.message,
    });
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.get("/bridge-recordings/:recordingId", (req, res) => {
  try {
    const recordingId = String(req.params.recordingId || "");
    const token = String(req.query.token || "");
    if (!recordingId || token !== signBridgeRecordingAccess(recordingId)) {
      res.status(403).json({ ok: false, error: "Recording access link is invalid." });
      return;
    }
    const recording = bridgeRecordings.get(recordingId);
    if (!recording || recording.expiresAt < Date.now()) {
      bridgeRecordings.delete(recordingId);
      res.status(404).json({ ok: false, error: "Recording is no longer available." });
      return;
    }
    res.setHeader("Content-Type", "audio/wav");
    res.setHeader("Content-Length", String(recording.media.length));
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.setHeader(
      "Content-Disposition",
      `${req.query.download === "1" ? "attachment" : "inline"}; filename="voicecall-answering-${recordingId}.wav"`,
    );
    res.send(recording.media);
  } catch (error) {
    log("error", "Failed to stream bridge recording", {
      recordingId: req.params.recordingId,
      error: error.message,
    });
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.get("/recordings/:recordingSid", async (req, res) => {
  try {
    requireTwilioConfig();
    const recordingSid = normalizeRecordingSid(req.params.recordingSid);
    const callSid = normalizeCallSid(req.query.callSid);
    const token = String(req.query.token || "");
    if (!isRecordingAccessTokenValid(recordingSid, callSid, token)) {
      res
        .status(403)
        .json({ ok: false, error: "Recording access link is invalid." });
      return;
    }

    const format =
      String(req.query.format || "mp3").toLowerCase() === "wav" ? "wav" : "mp3";
    const upstreamHeaders = {
      Authorization: getTwilioBasicAuthHeader(),
      Accept: format === "wav" ? "audio/wav" : "audio/mpeg",
    };
    const range = req.get("range");
    if (range) upstreamHeaders.Range = range;

    const upstream = await fetch(
      buildTwilioRecordingMediaUrl(recordingSid, format),
      {
        headers: upstreamHeaders,
      },
    );

    if (!upstream.ok && upstream.status !== 206) {
      const errorBody = await upstream.text().catch(() => "");
      log("warn", "Twilio recording media request failed", {
        recordingSid,
        status: upstream.status,
        error: errorBody.slice(0, 500),
      });
      res
        .status(upstream.status || 502)
        .json({ ok: false, error: "Recording media is not available yet." });
      return;
    }

    const passthroughHeaders = [
      "accept-ranges",
      "cache-control",
      "content-length",
      "content-range",
      "content-type",
      "etag",
      "last-modified",
    ];
    for (const header of passthroughHeaders) {
      const value = upstream.headers.get(header);
      if (value) res.setHeader(header, value);
    }
    if (!upstream.headers.get("content-type")) {
      res.setHeader(
        "Content-Type",
        format === "wav" ? "audio/wav" : "audio/mpeg",
      );
    }
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.setHeader("Vary", "Origin, Range");
    res.setHeader(
      "Content-Disposition",
      `${req.query.download === "1" ? "attachment" : "inline"}; filename="voicecall-recording-${recordingSid}.${format}"`,
    );
    res.status(upstream.status);
    if (!upstream.body) {
      res.end();
      return;
    }
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (error) {
    log("error", "Failed to stream recording media", {
      recordingSid: req.params.recordingSid,
      error: error.message,
    });
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post("/billing/create-checkout-session", async (req, res) => {
  try {
    const purchaseIntentId = String(req.body.purchaseIntentId || "");
    if (!purchaseIntentId) {
      throw new Error("purchaseIntentId is required.");
    }
    const session = await createCheckoutSession({
      purchaseIntentId,
      returnUrl: req.body.returnUrl,
    });
    res.json({
      ok: true,
      id: session.id,
      url: session.url,
    });
  } catch (error) {
    log("error", "Failed to create Checkout Session", { error: error.message });
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post("/initiate-call", async (req, res) => {
  let reservationId = "";
  let reservation = null;
  let session = null;
  try {
    requireServerConfig();
    reservationId = String(req.body.reservationId || "");
    const callToken = String(req.body.callToken || "");
    if (!reservationId || !callToken) {
      throw new Error("A paid call reservation is required.");
    }
    const actor = await getBackendActor();
    const configuredLines = await getConfiguredTwilioLineNumbers();
    if (configuredLines.length === 0) {
      throw new Error(
        "No Twilio phone lines are configured. Add at least one enabled number in Admin Dashboard.",
      );
    }
    const verified = await actor.verifyCallReservation(reservationId, callToken);
    reservation = normalizeReservation(
      okOrThrow(verified, "Unable to verify paid call reservation."),
    );
    const recipientPhone = normalizePhone(reservation.recipientPhone);
    const preset = toPlainPreset(req.body.preset);
    assertSafeInstructionText(preset.systemPrompt, "Call preset instructions");
    const callId = String(req.body.callId || reservation.callId || "");
    if (callId && callId !== reservation.callId) {
      throw new Error("Call ID does not match the paid reservation.");
    }
    const sessionId = crypto.randomUUID();
    const monitorToken = crypto.randomBytes(24).toString("base64url");
    const publicBaseUrl = getPublicBaseUrl();
    const twimlUrl = new URL("/twiml", publicBaseUrl);
    twimlUrl.searchParams.set("sessionId", sessionId);

    const statusCallbackUrl = new URL("/call-status", publicBaseUrl);
    statusCallbackUrl.searchParams.set("sessionId", sessionId);
    const captureOptions = normalizeCaptureOptions(req.body.captureOptions || {});

    session = {
      id: sessionId,
      monitorToken,
      callId,
      reservationId,
      allowedSeconds: reservation.allowedSeconds,
      recipientPhone,
      direction: CALL_DIRECTIONS.OUTBOUND,
      preset,
      saveTranscript: captureOptions.saveTranscript,
      recordAudio: captureOptions.recordAudio,
      permissionConfirmed: captureOptions.permissionConfirmed,
      recordingMode: "twilio",
      state: "created",
      queueEnteredAt: null,
      createdAt: Date.now(),
      billingStartedAt: null,
      billingFinishedAt: null,
      billingStoppedAt: null,
      cutoffTimer: null,
      finishTimer: null,
      finished: false,
      callSid: null,
      lineNumber: null,
      streamSid: null,
      twilioWs: null,
      xaiWs: null,
      xaiResponseInProgress: false,
      steeringCount: 0,
      lastSteeringAt: null,
      twimlUrl: twimlUrl.toString(),
      statusCallbackUrl: statusCallbackUrl.toString(),
      recordingStatusUrl: getPublicRecordingStatusUrl(sessionId),
      transcript: [],
      awaitingCallerTranscript: false,
      recording: null,
      bridgeRecordingChunks: null,
      metrics: createNaturalnessMetrics(),
      monitorClients: new Set(),
    };
    callSessions.set(sessionId, session);

    const lineNumber = await getAvailableLineNumber();
    if (!lineNumber) {
      enqueueCallSession(session);
      log("info", "Call queued because all Twilio lines are busy", {
        callId,
        sessionId,
        queuePosition: getQueuePosition(sessionId),
      });

      res.status(202).json({
        ...buildCallSessionPayload(session),
        allowedSeconds: reservation.allowedSeconds,
      });
      return;
    }

    const call = await createTwilioCallForSession(session, lineNumber, actor);
    if (!call) {
      throw new Error("No Twilio line is currently available.");
    }

    res.json({
      ok: true,
      callSid: call.sid,
      sessionId,
      monitorToken,
      status: call.status,
      allowedSeconds: reservation.allowedSeconds,
      liveAudio: {
        codec: "audio/pcmu",
        sampleRate: 8000,
      },
    });
  } catch (error) {
    log("error", "Failed to initiate call", { error: error.message });
    if (session?.callSid && twilioClient) {
      try {
        await twilioClient.calls(session.callSid).update({ status: "completed" });
      } catch (endError) {
        log("warn", "Unable to end failed Twilio call", {
          callSid: session.callSid,
          error: endError.message,
        });
      }
    }
    if (session) {
      removeQueuedSession(session.id);
      releaseSessionLine(session);
      callSessions.delete(session.id);
    }
    if (reservationId && reservation) {
      try {
        const actor = await getBackendActor();
        await actor.cancelCallReservation(reservationId, error.message);
      } catch (cancelError) {
        log("warn", "Unable to cancel failed reservation", {
          reservationId,
          error: cancelError.message,
        });
      }
    }
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post("/answering/incoming/:webhookSecret", async (req, res) => {
  res.type("text/xml");
  let session = null;
  let reservation = null;
  try {
    requireRealtimeBridgeConfig();
    const webhookSecret = String(req.params.webhookSecret || "").trim();
    const twilioToNumber = normalizePhone(req.body.To);
    const callerPhone = normalizeIncomingCallerPhone(req.body.From);
    const callSid = normalizeCallSid(req.body.CallSid);
    if (!webhookSecret) {
      throw new Error("Missing answering webhook secret.");
    }

    const actor = await getBackendActor();
    const verifiedResult = await actor.verifyAnsweringPresetForServer(
      webhookSecret,
      twilioToNumber,
    );
    if (verifiedResult?.err) {
      throw new Error(verifiedResult.err);
    }

    const rawPreset = unwrapOptional(
      await actor.getAnsweringPresetForServer(webhookSecret, twilioToNumber),
    );
    const answeringPreset = normalizeAnsweringPreset(rawPreset);
    if (!answeringPreset) {
      throw new Error("Answering preset was not found for this Twilio number.");
    }
    if (answeringPreset.verificationStatus !== "verified") {
      throw new Error("Answering preset phone number is not verified yet.");
    }
    if (!answeringPreset.enabled) {
      throw new Error("Answering service is turned off for this preset.");
    }

    const reservationResult = await actor.reserveIncomingAnsweringCall(
      webhookSecret,
      callerPhone,
      twilioToNumber,
      callSid,
    );
    reservation = normalizeReservation(
      okOrThrow(reservationResult, "Unable to reserve paid answering time."),
    );

    const sessionId = crypto.randomUUID();
    const monitorToken = crypto.randomBytes(24).toString("base64url");
    const publicWsUrl = getPublicWsUrl();
    if (!publicWsUrl) {
      throw new Error("Voice server public WebSocket URL is not configured.");
    }

    const preset = toPlainAnsweringPreset(answeringPreset);
    assertSafeInstructionText(preset.systemPrompt, "Answering preset instructions");

    session = {
      id: sessionId,
      monitorToken,
      callId: reservation.callId,
      reservationId: reservation.id,
      answeringPresetId: answeringPreset.id,
      answeringPresetName: answeringPreset.name,
      allowedSeconds: reservation.allowedSeconds,
      recipientPhone: callerPhone,
      direction: CALL_DIRECTIONS.INBOUND,
      shouldGreet: true,
      preset,
      saveTranscript: preset.captureOptions.saveTranscript,
      recordAudio: preset.captureOptions.recordAudio,
      permissionConfirmed: preset.captureOptions.permissionConfirmed,
      recordingMode: "bridge",
      state: "active",
      queueEnteredAt: null,
      createdAt: Date.now(),
      billingStartedAt: null,
      billingFinishedAt: null,
      billingStoppedAt: null,
      cutoffTimer: null,
      finishTimer: null,
      finished: false,
      callSid,
      lineNumber: twilioToNumber,
      streamSid: null,
      twilioWs: null,
      xaiWs: null,
      xaiResponseInProgress: false,
      steeringCount: 0,
      lastSteeringAt: null,
      twimlUrl: "",
      statusCallbackUrl: "",
      recordingStatusUrl: "",
      transcript: [],
      awaitingCallerTranscript: false,
      recording: null,
      bridgeRecordingChunks: [],
      metrics: createNaturalnessMetrics(),
      monitorClients: new Set(),
    };
    callSessions.set(sessionId, session);
    callsBySid.set(callSid, sessionId);

    await actor.registerAnsweringLiveSessionForServer({
      sessionId,
      monitorToken,
      callSid,
      userId: principalFromText(reservation.user),
      answeringPresetId: BigInt(answeringPreset.id),
      answeringPresetName: answeringPreset.name,
      callerPhone,
      startedAt: BigInt(Date.now()) * 1_000_000n,
      allowedSeconds: BigInt(reservation.allowedSeconds),
    });

    const response = new VoiceResponse();
    const connect = response.connect();
    const stream = connect.stream({
      url: publicWsUrl,
      name: `voicecall-answering-${sessionId}`,
    });
    stream.parameter({ name: "sessionId", value: sessionId });
    stream.parameter({ name: "callId", value: String(reservation.callId || "") });
    stream.parameter({ name: "presetName", value: answeringPreset.name });
    stream.parameter({ name: "direction", value: session.direction });
    res.status(200).send(response.toString());
  } catch (error) {
    log("warn", "Incoming answering call rejected", {
      to: req.body?.To,
      from: req.body?.From,
      callSid: req.body?.CallSid,
      error: error.message,
    });
    if (session) {
      callSessions.delete(session.id);
      if (session.callSid) callsBySid.delete(session.callSid);
    }
    if (reservation?.id) {
      getBackendActor()
        .then((actor) =>
          actor.cancelCallReservation(
            reservation.id,
            `Incoming answering call rejected: ${error.message}`,
          ),
        )
        .catch((cancelError) => {
          log("warn", "Unable to cancel rejected answering reservation", {
            reservationId: reservation.id,
            error: cancelError.message,
          });
        });
    }
    res.status(200).send(makeRejectTwiML("busy"));
  }
});

app.post("/steer-call", (req, res) => {
  try {
    requireServerConfig();
    const sessionId = String(req.body.sessionId || "");
    const token = String(req.body.monitorToken || req.body.controlToken || "");
    const session = callSessions.get(sessionId);
    if (!session || session.finished) {
      res.status(404).json({ ok: false, error: "Call session not found." });
      return;
    }
    if (!token || token !== session.monitorToken) {
      res.status(403).json({ ok: false, error: "Invalid live call token." });
      return;
    }
    if (!session.callSid || session.state === "queued") {
      res.status(409).json({ ok: false, error: "The call is not live yet." });
      return;
    }

    const prompt = normalizeSteeringPrompt(req.body.prompt);
    const guidance = buildLiveGuidanceText(prompt);
    sendXaiUserText(session, guidance, { cancelCurrent: true });
    session.lastSteeringAt = Date.now();
    session.steeringCount = (session.steeringCount || 0) + 1;
    log("info", "Live call guidance sent to xAI", {
      sessionId,
      callSid: session.callSid,
      steeringCount: session.steeringCount,
    });
    res.json({ ok: true });
  } catch (error) {
    const status = error.code === "SAFETY_BLOCKED" ? 400 : 409;
    log(
      error.code === "SAFETY_BLOCKED" ? "warn" : "error",
      "Failed to steer call",
      {
        sessionId: req.body?.sessionId,
        error: error.message,
        category: error.category,
      },
    );
    res.status(status).json({ ok: false, error: error.message });
  }
});

app.post("/end-call", async (req, res) => {
  try {
    requireServerConfig();
    const callSid = String(req.body.callSid || "");
    const sessionId = String(req.body.sessionId || "");
    if (!callSid && sessionId) {
      const session = callSessions.get(sessionId);
      if (!session) {
        res.json({ ok: true });
        return;
      }
      if (session.state === "queued" && !session.callSid) {
        await cancelQueuedSession(session, "Caller canceled queued call.");
        res.json({ ok: true });
        return;
      }
    }
    if (!/^CA[a-fA-F0-9]{32}$/.test(callSid)) {
      throw new Error("A valid Twilio CallSid is required.");
    }
    await twilioClient.calls(callSid).update({ status: "completed" });
    const activeSessionId = callsBySid.get(callSid);
    if (activeSessionId) {
      const session = callSessions.get(activeSessionId);
      if (session) {
        session.endedAt = Date.now();
        session.billingStoppedAt ||= session.endedAt;
        scheduleFinishPaidSession(session, "user_requested_end_fallback");
      }
    }
    res.json({ ok: true });
  } catch (error) {
    log("error", "Failed to end call", { error: error.message });
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.get("/call-session/:sessionId", (req, res) => {
  const session = callSessions.get(String(req.params.sessionId || ""));
  if (!session) {
    res.status(404).json({ ok: false, error: "Call session not found." });
    return;
  }
  res.json(buildCallSessionPayload(session));
});

app.post("/twiml", (req, res) => {
  res.type("text/xml");
  try {
    if (!validateTwilioRequest(req)) {
      log("warn", "Rejected Twilio webhook with invalid signature");
      res.status(403).send(makeErrorTwiML("Request validation failed."));
      return;
    }

    const publicWsUrl = getPublicWsUrl();
    const { sessionId, session } = getSessionFromRequest(req);
    if (!publicWsUrl || !session) {
      log("warn", "TwiML requested without a matching session", { sessionId });
      res
        .status(200)
        .send(makeErrorTwiML("This call session is not available. Please try again."));
      return;
    }

    const response = new VoiceResponse();
    const connect = response.connect();
    const stream = connect.stream({
      url: publicWsUrl,
      name: `voicecall-ai-${sessionId}`,
    });
    stream.parameter({ name: "sessionId", value: sessionId });
    stream.parameter({ name: "callId", value: session.callId || "" });
    stream.parameter({ name: "presetName", value: session.preset.name });
    stream.parameter({ name: "direction", value: session.direction || "" });

    res.status(200).send(response.toString());
  } catch (error) {
    log("error", "Failed to generate TwiML", { error: error.message });
    res.status(200).send(makeErrorTwiML("The voice server could not start this call."));
  }
});

app.post("/call-status", async (req, res) => {
  if (!validateTwilioRequest(req)) {
    log("warn", "Rejected status callback with invalid signature");
    res.sendStatus(403);
    return;
  }

  const { sessionId, session } = getSessionFromRequest(req);
  if (session) {
    session.lastStatus = req.body.CallStatus;
    session.lastStatusAt = Date.now();
    updateSessionRecordingFromBody(session, req.body);
    if (isTerminalTwilioStatus(req.body.CallStatus)) {
      session.billingStoppedAt ||= Date.now();
      scheduleFinishPaidSession(session, `twilio_${req.body.CallStatus}`);
    }
  }
  log("info", "Twilio status callback", {
    sessionId,
    callSid: req.body.CallSid,
    status: req.body.CallStatus,
  });
  res.sendStatus(204);
});

app.post("/recording-status", async (req, res) => {
  if (!validateTwilioRequest(req)) {
    log("warn", "Rejected recording callback with invalid signature");
    res.sendStatus(403);
    return;
  }

  const { sessionId, session } = getSessionFromRequest(req);
  if (session) {
    updateSessionRecordingFromBody(session, req.body);
    log("info", "Twilio recording callback", {
      sessionId,
      callSid: req.body.CallSid,
      recordingSid: req.body.RecordingSid,
      recordingStatus: req.body.RecordingStatus,
    });
    if (
      session.finishTimer &&
      !session.awaitingCallerTranscript &&
      ["completed", "absent"].includes(
        String(req.body.RecordingStatus || "").toLowerCase(),
      )
    ) {
      await finishPaidSession(
        session,
        `twilio_recording_${String(req.body.RecordingStatus || "done").toLowerCase()}`,
      );
    }
  } else {
    log("info", "Recording callback without active session", {
      sessionId,
      callSid: req.body.CallSid,
      recordingSid: req.body.RecordingSid,
      recordingStatus: req.body.RecordingStatus,
    });
  }
  res.sendStatus(204);
});

const server = http.createServer(app);
const mediaWss = new WebSocketServer({ noServer: true });
const monitorWss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url || "/", "http://localhost");
  if (url.pathname === "/media") {
    mediaWss.handleUpgrade(request, socket, head, (ws) => {
      mediaWss.emit("connection", ws, request);
    });
    return;
  }
  if (url.pathname === "/monitor") {
    const origin = request.headers.origin;
    if (!isOriginAllowed(origin)) {
      socket.destroy();
      return;
    }
    monitorWss.handleUpgrade(request, socket, head, (ws) => {
      monitorWss.emit("connection", ws, request);
    });
    return;
  }
  if (url.pathname !== "/media") {
    socket.destroy();
    return;
  }
});

monitorWss.on("connection", (ws, request) => {
  const url = new URL(request.url || "/", "http://localhost");
  const sessionId = url.searchParams.get("sessionId") || "";
  const token = url.searchParams.get("token") || "";
  const session = callSessions.get(sessionId);
  if (!session || session.finished || token !== session.monitorToken) {
    ws.send(JSON.stringify({ type: "error", error: "Live audio is not available." }));
    ws.close(1008, "Invalid live audio session");
    return;
  }
  session.monitorClients.add(ws);
  ws.send(
    JSON.stringify({
      type: "ready",
      sessionId,
      codec: "audio/pcmu",
      sampleRate: 8000,
    }),
  );
  ws.on("close", () => session.monitorClients.delete(ws));
  ws.on("error", () => session.monitorClients.delete(ws));
});

mediaWss.on("connection", (twilioWs, request) => {
  let xaiWs = null;
  let sttWs = null;
  let sttReady = false;
  let sttDoneRequested = false;
  let sttDoneSent = false;
  const pendingSttAudio = [];
  const callerTranscriptSegments = [];
  let session = null;
  let streamSid = null;
  let markCounter = 0;
  let closed = false;

  function closeBoth() {
    if (closed) return;
    closed = true;
    if (xaiWs && xaiWs.readyState === WebSocket.OPEN) xaiWs.close();
    if (twilioWs.readyState === WebSocket.OPEN) twilioWs.close();
    finishCallerTranscription();
  }

  function sendToTwilio(payload) {
    if (twilioWs.readyState === WebSocket.OPEN) {
      twilioWs.send(JSON.stringify(payload));
    }
  }

  function getInboundOpeningGreeting() {
    return (
      normalizeInboundGreeting(session?.preset?.inboundGreeting) ||
      normalizeInboundGreeting(session?.preset?.openingLine) ||
      normalizeInboundGreeting(process.env.INBOUND_CALL_GREETING) ||
      normalizeInboundGreeting(process.env.CALL_GREETING)
    );
  }

  function getOutboundOpeningLine() {
    return normalizeOptionalInstructionText(
      session?.preset?.outboundIntroAfterHello || session?.preset?.openingLine,
    );
  }

  function sendOpeningOnlyTurn(trigger) {
    if (!session || session.openingTurnSent) return;
    const direction = normalizeCallDirection(session.direction);
    const openingLine =
      direction === CALL_DIRECTIONS.INBOUND
        ? getInboundOpeningGreeting()
        : getOutboundOpeningLine();
    if (openingLine) {
      assertSafeInstructionText(
        openingLine,
        direction === CALL_DIRECTIONS.INBOUND
          ? "Inbound call greeting"
          : "Outbound opening line",
      );
    }
    sendXaiUserText(
      session,
      buildOpeningOnlyTurnInstruction(direction, openingLine),
    );
    session.openingTurnSent = true;
    log("info", "Triggered greeting-only opening turn", {
      sessionId: session.id,
      callSid: session.callSid,
      trigger,
      direction,
      presetOpening: Boolean(openingLine),
    });
  }

  function sendOpeningTurnIfNeeded(trigger) {
    if (!session || session.openingTurnSent) return;
    const direction = normalizeCallDirection(session.direction);
    if (direction !== CALL_DIRECTIONS.INBOUND && !session.outboundWaitLogged) {
      session.outboundWaitLogged = true;
      log("info", "Outbound media stream ready; waiting for callee to speak first", {
        sessionId: session.id,
        callSid: session.callSid,
        trigger,
      });
      return;
    }
    if (
      direction !== CALL_DIRECTIONS.INBOUND ||
      !isWebSocketOpen(session.xaiWs)
    ) {
      return;
    }
    try {
      sendOpeningOnlyTurn(trigger);
    } catch (error) {
      if (error.code === "SAFETY_BLOCKED") session.openingTurnSent = true;
      log(
        error.code === "SAFETY_BLOCKED" ? "warn" : "error",
        "Skipped inbound opening greeting",
        {
          sessionId: session.id,
          error: error.message,
          category: error.category,
          trigger,
        },
      );
    }
  }

  function appendCallerTranscript(text) {
    const cleanText = String(text || "").trim();
    if (!cleanText) return;
    if (callerTranscriptSegments[callerTranscriptSegments.length - 1] === cleanText) {
      return;
    }
    callerTranscriptSegments.push(cleanText);
    appendTranscript(session, "caller", `${cleanText}\n`);
    if (session?.metrics) {
      session.metrics.callerTranscriptChars += cleanText.length;
    }
  }

  function flushPendingSttAudio() {
    if (!sttWs || sttWs.readyState !== WebSocket.OPEN || !sttReady) return;
    while (pendingSttAudio.length > 0) {
      sttWs.send(pendingSttAudio.shift());
    }
  }

  function connectToStt() {
    if (!session?.saveTranscript || !session.permissionConfirmed) return;
    session.awaitingCallerTranscript = true;
    sttWs = new WebSocket(
      "wss://api.x.ai/v1/stt?sample_rate=8000&encoding=mulaw&language=en&endpointing=500",
      {
        headers: {
          Authorization: `Bearer ${process.env.XAI_API_KEY}`,
        },
      },
    );

    sttWs.on("message", (raw) => {
      let event;
      try {
        event = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (event.type === "transcript.created") {
        sttReady = true;
        flushPendingSttAudio();
        if (sttDoneRequested) finishCallerTranscription();
        return;
      }

      if (event.type === "transcript.partial" && event.text && event.is_final) {
        appendCallerTranscript(event.text);
        return;
      }

      if (event.type === "transcript.done") {
        if (callerTranscriptSegments.length === 0 && event.text) {
          appendCallerTranscript(event.text);
        }
        session.awaitingCallerTranscript = false;
        if (sttWs?.readyState === WebSocket.OPEN) sttWs.close();
        const recordingStatus = String(session.recording?.status || "").toLowerCase();
        const waitingForRecording =
          session.recordAudio &&
          !session.recording?.url &&
          !["completed", "absent"].includes(recordingStatus);
        if (session.finishTimer && !waitingForRecording) {
          finishPaidSession(session, "xai_stt_completed");
        }
        return;
      }

      if (event.type === "error") {
        log("error", "xAI STT error", {
          sessionId: session?.id,
          error: event.message || event.error?.message || JSON.stringify(event),
        });
        session.awaitingCallerTranscript = false;
      }
    });

    sttWs.on("error", (error) => {
      log("error", "xAI STT WebSocket error", {
        sessionId: session?.id,
        error: error.message,
      });
      if (session) session.awaitingCallerTranscript = false;
    });

    sttWs.on("close", () => {
      sttReady = false;
      if (session?.awaitingCallerTranscript && sttDoneSent) {
        session.awaitingCallerTranscript = false;
      }
    });
  }

  function sendCallerAudioToStt(payload) {
    if (!sttWs || sttDoneRequested || sttDoneSent || !payload) return;
    const frame = Buffer.from(payload, "base64");
    if (sttWs.readyState === WebSocket.OPEN && sttReady) {
      sttWs.send(frame);
      return;
    }
    if (pendingSttAudio.length < 250) {
      pendingSttAudio.push(frame);
    }
  }

  function finishCallerTranscription() {
    if (!sttWs || sttDoneSent) return;
    sttDoneRequested = true;
    if (sttWs.readyState === WebSocket.OPEN && sttReady) {
      sttWs.send(JSON.stringify({ type: "audio.done" }));
      sttDoneSent = true;
    } else if (sttWs.readyState === WebSocket.OPEN) {
      return;
    } else if (session) {
      session.awaitingCallerTranscript = false;
    }
  }

  function connectToXai() {
    if (!session) return;
    xaiWs = new WebSocket(
      `wss://api.x.ai/v1/realtime?model=${encodeURIComponent(XAI_MODEL)}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.XAI_API_KEY}`,
        },
      },
    );
    session.xaiWs = xaiWs;

    xaiWs.on("open", () => {
      xaiWs.send(
        JSON.stringify(
          buildXaiSessionUpdate(session.preset, {
            direction: session.direction,
          }),
        ),
      );
      const openingTimer = setTimeout(
        () => sendOpeningTurnIfNeeded("session_update_timer"),
        350,
      );
      openingTimer.unref?.();
      log("info", "Connected Twilio stream to xAI", {
        streamSid,
        sessionId: session.id,
        callSid: session.callSid,
        direction: session.direction,
      });
    });

    xaiWs.on("message", (raw) => {
      let event;
      try {
        event = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (event.type === "session.updated") {
        sendOpeningTurnIfNeeded("session.updated");
        return;
      }

      if (event.type === "response.output_audio.delta" && event.delta && streamSid) {
        if (session.metrics) {
          session.metrics.assistantAudioChunks += 1;
          session.metrics.firstAssistantAudioAt ||= Date.now();
        }
        sendToTwilio({
          event: "media",
          streamSid,
          media: { payload: event.delta },
        });
        broadcastMonitorAudio(session, "assistant", event.delta);
        appendBridgeRecordingAudio(session, event.delta);
        markCounter += 1;
        sendToTwilio({
          event: "mark",
          streamSid,
          mark: { name: `${STREAM_MARK_PREFIX}-${markCounter}` },
        });
        return;
      }

      if (event.type === "response.created") {
        const direction = normalizeCallDirection(session.direction);
        if (
          direction === CALL_DIRECTIONS.OUTBOUND &&
          !session.openingTurnSent &&
          isWebSocketOpen(xaiWs)
        ) {
          xaiWs.send(JSON.stringify({ type: "response.cancel" }));
          sendTwilioClear(session);
          session.xaiResponseInProgress = false;
          try {
            sendOpeningOnlyTurn("outbound_first_response");
          } catch (error) {
            if (error.code === "SAFETY_BLOCKED") {
              session.openingTurnSent = true;
            }
            log(
              error.code === "SAFETY_BLOCKED" ? "warn" : "error",
              "Skipped outbound opening line",
              {
                sessionId: session.id,
                error: error.message,
                category: error.category,
              },
            );
          }
          return;
        }
        session.xaiResponseInProgress = true;
        if (session.metrics) session.metrics.assistantTurns += 1;
        return;
      }

      if (event.type === "response.done") {
        session.xaiResponseInProgress = false;
        return;
      }

      if (event.type === "input_audio_buffer.speech_started" && streamSid) {
        if (session.metrics) session.metrics.callerSpeechStarts += 1;
        if (session.xaiResponseInProgress && isWebSocketOpen(xaiWs)) {
          if (session.metrics) session.metrics.bargeInCount += 1;
          xaiWs.send(JSON.stringify({ type: "response.cancel" }));
          session.xaiResponseInProgress = false;
        }
        sendToTwilio({ event: "clear", streamSid });
        return;
      }

      if (event.type === "response.output_audio_transcript.delta" && event.delta) {
        if (session.metrics) {
          session.metrics.assistantTranscriptChars += String(event.delta).length;
        }
        appendTranscript(session, "assistant", event.delta);
        return;
      }

      if (
        event.type === "conversation.item.input_audio_transcription.completed" &&
        (event.transcript || event.text)
      ) {
        const text = event.transcript || event.text;
        if (session.metrics) {
          session.metrics.callerTranscriptChars += String(text).length;
        }
        appendTranscript(session, "caller", text);
        return;
      }

      if (event.type === "error") {
        log("error", "xAI realtime error", {
          sessionId: session.id,
          error: event.error?.message || JSON.stringify(event.error || event),
        });
      }
    });

    xaiWs.on("close", () => {
      log("info", "xAI WebSocket closed", {
        sessionId: session?.id,
        streamSid,
      });
      if (session?.xaiWs === xaiWs) {
        session.xaiWs = null;
        session.xaiResponseInProgress = false;
      }
    });

    xaiWs.on("error", (error) => {
      log("error", "xAI WebSocket error", {
        sessionId: session?.id,
        error: error.message,
      });
      closeBoth();
    });
  }

  twilioWs.on("message", (raw) => {
    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (data.event === "start") {
      streamSid = data.start?.streamSid;
      const sessionId = data.start?.customParameters?.sessionId;
      session = callSessions.get(sessionId);
      if (!session) {
        log("warn", "Media stream started without a matching session", {
          sessionId,
          streamSid,
          remoteAddress: request.socket.remoteAddress,
        });
        closeBoth();
        return;
      }
      session.twilioWs = twilioWs;
      session.streamSid = streamSid;
      if (session.metrics) session.metrics.streamStartedAt ||= Date.now();
      startBillingTimer(session, closeBoth);
      connectToStt();
      connectToXai();
      return;
    }

    if (data.event === "media") {
      if (data.media?.payload) {
        broadcastMonitorAudio(session, "caller", data.media.payload);
        appendBridgeRecordingAudio(session, data.media.payload);
        sendCallerAudioToStt(data.media.payload);
      }
      if (xaiWs && xaiWs.readyState === WebSocket.OPEN && data.media?.payload) {
        xaiWs.send(
          JSON.stringify({
            type: "input_audio_buffer.append",
            audio: data.media.payload,
          }),
        );
      }
      return;
    }

    if (data.event === "stop") {
      log("info", "Twilio media stream stopped", {
        sessionId: session?.id,
        streamSid,
      });
      if (session) session.billingStoppedAt ||= Date.now();
      finishCallerTranscription();
      closeBoth();
      scheduleFinishPaidSession(session, "twilio_media_stop");
    }
  });

  twilioWs.on("close", () => {
    if (xaiWs && xaiWs.readyState === WebSocket.OPEN) xaiWs.close();
    if (session?.twilioWs === twilioWs) session.twilioWs = null;
    if (session) session.billingStoppedAt ||= Date.now();
    finishCallerTranscription();
    scheduleFinishPaidSession(session, "twilio_ws_close");
  });

  twilioWs.on("error", (error) => {
    log("error", "Twilio media WebSocket error", { error: error.message });
    closeBoth();
  });
});

setInterval(() => {
  const cutoff = Date.now() - SESSION_TTL_MS;
  const now = Date.now();
  for (const [sessionId, session] of callSessions.entries()) {
    if (
      session.state === "queued" &&
      Date.now() - session.queueEnteredAt > CALL_QUEUE_MAX_WAIT_MS
    ) {
      cancelQueuedSession(
        session,
        "No Twilio line became available before the queue timeout.",
      );
      continue;
    }
    if (session.createdAt < cutoff) {
      finishPaidSession(session, "session_ttl_cleanup");
    }
  }
  for (const [recordingId, recording] of bridgeRecordings.entries()) {
    if (recording.expiresAt < now) {
      bridgeRecordings.delete(recordingId);
    }
  }
  dispatchQueuedSessions().catch((error) => {
    log("error", "Queued call dispatch failed during cleanup", {
      error: error.message,
    });
  });
}, 15 * 60 * 1000).unref();

server.listen(PORT, () => {
  const missing = requiredEnv.filter((key) => !process.env[key]);
  if (!process.env.BACKEND_CANISTER_ID) missing.push("BACKEND_CANISTER_ID");
  if (!process.env.ICP_SERVER_IDENTITY_JSON && !process.env.ICP_SERVER_IDENTITY_SECRET_KEY) {
    missing.push("ICP_SERVER_IDENTITY_JSON");
  }
  log("info", "VoiceCall AI server listening", {
    serverVersion: SERVER_VERSION,
    port: PORT,
    publicHost: getPublicHost() || null,
    health: `http://localhost:${PORT}/health`,
    missingEnv: missing,
  });
});
