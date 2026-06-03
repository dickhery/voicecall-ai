import { Actor, HttpAgent } from "@dfinity/agent";
import { IDL } from "@dfinity/candid";
import { Ed25519KeyIdentity } from "@dfinity/identity";
import { Principal } from "@dfinity/principal";

const StripeMode = IDL.Variant({
  test: IDL.Null,
  live: IDL.Null,
});

const PurchaseIntentStatus = IDL.Variant({
  pending: IDL.Null,
  paid: IDL.Null,
  canceled: IDL.Null,
});

const CallReservationStatus = IDL.Variant({
  reserved: IDL.Null,
  active: IDL.Null,
  finished: IDL.Null,
  canceled: IDL.Null,
});

const Voice = IDL.Variant({
  eve: IDL.Null,
  ara: IDL.Null,
  rex: IDL.Null,
  sal: IDL.Null,
  leo: IDL.Null,
});

const AudioFormat = IDL.Variant({
  pcmu: IDL.Null,
  pcm: IDL.Null,
  pcma: IDL.Null,
});

const SampleRate = IDL.Variant({
  hz8000: IDL.Null,
  hz16000: IDL.Null,
  hz22050: IDL.Null,
  hz24000: IDL.Null,
  hz32000: IDL.Null,
  hz44100: IDL.Null,
  hz48000: IDL.Null,
});

const TurnDetection = IDL.Record({
  serverVad: IDL.Bool,
  threshold: IDL.Float64,
  silenceDurationMs: IDL.Nat,
  prefixPaddingMs: IDL.Nat,
});

const ToolsEnabled = IDL.Record({
  webSearch: IDL.Bool,
  xSearch: IDL.Bool,
  functionCalling: IDL.Bool,
});

const AnsweringPresetStatus = IDL.Variant({
  pendingVerification: IDL.Null,
  verified: IDL.Null,
});

const AnsweringCaptureOptions = IDL.Record({
  saveTranscript: IDL.Bool,
  recordAudio: IDL.Bool,
  consentConfirmed: IDL.Bool,
});

const AnsweringPreset = IDL.Record({
  id: IDL.Nat,
  ownerId: IDL.Principal,
  name: IDL.Text,
  phoneNumber: IDL.Text,
  systemPrompt: IDL.Text,
  voice: Voice,
  voiceId: IDL.Opt(IDL.Text),
  turnDetection: TurnDetection,
  audioFormat: AudioFormat,
  sampleRate: SampleRate,
  toolsEnabled: ToolsEnabled,
  captureOptions: AnsweringCaptureOptions,
  enabled: IDL.Bool,
  verificationStatus: AnsweringPresetStatus,
  webhookSecret: IDL.Text,
  createdAt: IDL.Int,
  updatedAt: IDL.Int,
  verifiedAt: IDL.Opt(IDL.Int),
  lastIncomingAt: IDL.Opt(IDL.Int),
});

const CallPreset = IDL.Record({
  id: IDL.Nat,
  ownerId: IDL.Principal,
  name: IDL.Text,
  systemPrompt: IDL.Text,
  voice: Voice,
  voiceId: IDL.Opt(IDL.Text),
  turnDetection: TurnDetection,
  audioFormat: AudioFormat,
  sampleRate: SampleRate,
  toolsEnabled: ToolsEnabled,
});

const AnsweringPresetMutationResult = IDL.Variant({
  ok: AnsweringPreset,
  err: IDL.Text,
});

const PurchaseIntentPublic = IDL.Record({
  id: IDL.Text,
  user: IDL.Principal,
  packageId: IDL.Text,
  amountCents: IDL.Nat,
  seconds: IDL.Nat,
  mode: StripeMode,
  createdAt: IDL.Int,
  status: PurchaseIntentStatus,
  stripeSessionId: IDL.Opt(IDL.Text),
  paidAt: IDL.Opt(IDL.Int),
});

const CallReservationPublic = IDL.Record({
  id: IDL.Text,
  callId: IDL.Nat,
  user: IDL.Principal,
  recipientPhone: IDL.Text,
  presetId: IDL.Nat,
  allowedSeconds: IDL.Nat,
  callToken: IDL.Opt(IDL.Text),
  createdAt: IDL.Int,
  expiresAt: IDL.Int,
  status: CallReservationStatus,
  startedAt: IDL.Opt(IDL.Int),
  finishedAt: IDL.Opt(IDL.Int),
  usedSeconds: IDL.Opt(IDL.Nat),
  billedSeconds: IDL.Opt(IDL.Nat),
  callSid: IDL.Opt(IDL.Text),
  transcript: IDL.Opt(IDL.Text),
  canceledReason: IDL.Opt(IDL.Text),
});

const AnsweringLiveSession = IDL.Record({
  sessionId: IDL.Text,
  monitorToken: IDL.Text,
  callSid: IDL.Text,
  userId: IDL.Principal,
  answeringPresetId: IDL.Nat,
  answeringPresetName: IDL.Text,
  callerPhone: IDL.Text,
  startedAt: IDL.Int,
  allowedSeconds: IDL.Nat,
});

const ReserveCallResult = IDL.Variant({
  ok: CallReservationPublic,
  err: IDL.Text,
});

const BillingMutationResult = IDL.Variant({
  ok: IDL.Bool,
  err: IDL.Text,
});

const idlFactory = ({ IDL }) =>
  IDL.Service({
    getPurchaseIntentForServer: IDL.Func(
      [IDL.Text],
      [IDL.Opt(PurchaseIntentPublic)],
      ["query"],
    ),
    getTwilioLineNumbersForServer: IDL.Func(
      [],
      [IDL.Vec(IDL.Text)],
      ["query"],
    ),
    getPresetForServer: IDL.Func(
      [IDL.Nat],
      [IDL.Opt(CallPreset)],
      ["query"],
    ),
    getAnsweringPresetForServer: IDL.Func(
      [IDL.Text, IDL.Text],
      [IDL.Opt(AnsweringPreset)],
      ["query"],
    ),
    verifyAnsweringPresetForServer: IDL.Func(
      [IDL.Text, IDL.Text],
      [AnsweringPresetMutationResult],
      [],
    ),
    reserveIncomingAnsweringCall: IDL.Func(
      [IDL.Text, IDL.Text, IDL.Text, IDL.Text],
      [ReserveCallResult],
      [],
    ),
    registerAnsweringLiveSessionForServer: IDL.Func(
      [AnsweringLiveSession],
      [IDL.Bool],
      [],
    ),
    finishAnsweringLiveSessionForServer: IDL.Func(
      [IDL.Text],
      [IDL.Bool],
      [],
    ),
    creditPaidSeconds: IDL.Func(
      [IDL.Text, IDL.Text, IDL.Principal, IDL.Nat, StripeMode],
      [BillingMutationResult],
      [],
    ),
    verifyCallReservation: IDL.Func(
      [IDL.Text, IDL.Text],
      [ReserveCallResult],
      [],
    ),
    markReservationStarted: IDL.Func(
      [IDL.Text, IDL.Text],
      [BillingMutationResult],
      [],
    ),
    extendCallReservationForServer: IDL.Func(
      [IDL.Text],
      [ReserveCallResult],
      [],
    ),
    listOpenCallReservationsForServer: IDL.Func(
      [IDL.Nat],
      [IDL.Vec(CallReservationPublic)],
      ["query"],
    ),
    finishCallAndDebit: IDL.Func(
      [IDL.Text, IDL.Nat, IDL.Opt(IDL.Text), IDL.Opt(IDL.Text)],
      [BillingMutationResult],
      [],
    ),
    finishCallByCallSidForServer: IDL.Func(
      [IDL.Text, IDL.Nat, IDL.Opt(IDL.Text)],
      [BillingMutationResult],
      [],
    ),
    cancelCallReservation: IDL.Func(
      [IDL.Text, IDL.Text],
      [BillingMutationResult],
      [],
    ),
    cancelCallReservationByCallSidForServer: IDL.Func(
      [IDL.Text, IDL.Text],
      [BillingMutationResult],
      [],
    ),
  });

let identityCache = null;
let actorPromise = null;

function parseSecretKeyBytes(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed);
    return Uint8Array.from(parsed);
  }
  if (/^[a-f0-9]{64}$/i.test(trimmed)) {
    const pairs = trimmed.match(/[a-f0-9]{2}/gi) || [];
    return Uint8Array.from(pairs.map((pair) => Number.parseInt(pair, 16)));
  }
  return Uint8Array.from(Buffer.from(trimmed, "base64"));
}

export function getIcpServerIdentity() {
  if (identityCache) return identityCache;
  const json = process.env.ICP_SERVER_IDENTITY_JSON;
  if (json?.trim()) {
    identityCache = Ed25519KeyIdentity.fromJSON(json.trim());
    return identityCache;
  }

  const secretKey = parseSecretKeyBytes(process.env.ICP_SERVER_IDENTITY_SECRET_KEY);
  if (secretKey) {
    identityCache = Ed25519KeyIdentity.fromSecretKey(secretKey);
    return identityCache;
  }

  throw new Error(
    "Missing ICP server identity. Set ICP_SERVER_IDENTITY_JSON in src/server/.env.",
  );
}

export function getIcpServerPrincipalText() {
  try {
    return getIcpServerIdentity().getPrincipal().toText();
  } catch {
    return "";
  }
}

function getBackendConfig() {
  const canisterId = process.env.BACKEND_CANISTER_ID;
  if (!canisterId) {
    throw new Error("Missing BACKEND_CANISTER_ID in the server environment.");
  }
  return {
    canisterId,
    host: process.env.BACKEND_HOST || "https://icp-api.io",
  };
}

export async function getBackendActor() {
  if (actorPromise) return actorPromise;
  actorPromise = (async () => {
    const { canisterId, host } = getBackendConfig();
    const agent = new HttpAgent({
      host,
      identity: getIcpServerIdentity(),
    });
    if (/localhost|127\.0\.0\.1|\[::1\]/i.test(host)) {
      await agent.fetchRootKey();
    }
    return Actor.createActor(idlFactory, {
      agent,
      canisterId,
    });
  })();
  return actorPromise;
}

export function principalFromText(text) {
  return Principal.fromText(text);
}

export function stripeModeToCandid(mode) {
  return mode === "test" ? { test: null } : { live: null };
}

export function variantKey(value) {
  return Object.keys(value || {})[0] || "";
}

export function unwrapOptional(value) {
  return Array.isArray(value) && value.length > 0 ? value[0] : null;
}

function bigintToNumber(value, fallback = 0) {
  if (value === null || value === undefined) return fallback;
  try {
    return Number(value);
  } catch {
    return fallback;
  }
}

function icTimeNsToMs(value) {
  if (value === null || value === undefined) return null;
  try {
    return Number(BigInt(value) / 1_000_000n);
  } catch {
    return null;
  }
}

function optionalNatToNumber(value) {
  const unwrapped = unwrapOptional(value);
  return unwrapped === null ? null : bigintToNumber(unwrapped, null);
}

function optionalIcTimeNsToMs(value) {
  return icTimeNsToMs(unwrapOptional(value));
}

export function normalizePurchaseIntent(intent) {
  if (!intent) return null;
  return {
    id: intent.id,
    user: intent.user.toText(),
    packageId: intent.packageId,
    amountCents: Number(intent.amountCents),
    seconds: Number(intent.seconds),
    mode: variantKey(intent.mode),
    createdAt: intent.createdAt,
    status: variantKey(intent.status),
    stripeSessionId: unwrapOptional(intent.stripeSessionId),
    paidAt: unwrapOptional(intent.paidAt),
  };
}

export function normalizeReservation(reservation) {
  return {
    id: reservation.id,
    callId: reservation.callId.toString(),
    user: reservation.user.toText(),
    recipientPhone: reservation.recipientPhone,
    presetId: reservation.presetId.toString(),
    allowedSeconds: Number(reservation.allowedSeconds),
    createdAt: reservation.createdAt,
    createdAtMs: icTimeNsToMs(reservation.createdAt),
    expiresAt: reservation.expiresAt,
    expiresAtMs: icTimeNsToMs(reservation.expiresAt),
    startedAt: unwrapOptional(reservation.startedAt),
    startedAtMs: optionalIcTimeNsToMs(reservation.startedAt),
    finishedAt: unwrapOptional(reservation.finishedAt),
    finishedAtMs: optionalIcTimeNsToMs(reservation.finishedAt),
    usedSeconds: optionalNatToNumber(reservation.usedSeconds),
    billedSeconds: optionalNatToNumber(reservation.billedSeconds),
    status: variantKey(reservation.status),
    callSid: unwrapOptional(reservation.callSid),
    transcript: unwrapOptional(reservation.transcript),
    canceledReason: unwrapOptional(reservation.canceledReason),
  };
}

export function normalizeAnsweringPreset(preset) {
  if (!preset) return null;
  return {
    id: preset.id.toString(),
    ownerId: preset.ownerId.toText(),
    name: preset.name,
    phoneNumber: preset.phoneNumber,
    systemPrompt: preset.systemPrompt,
    voice: variantKey(preset.voice),
    voiceId: unwrapOptional(preset.voiceId),
    turnDetection: {
      serverVad: preset.turnDetection.serverVad,
      threshold: Number(preset.turnDetection.threshold ?? 0.5),
      silenceDurationMs: Number(preset.turnDetection.silenceDurationMs ?? 500),
      prefixPaddingMs: Number(preset.turnDetection.prefixPaddingMs ?? 200),
    },
    audioFormat: variantKey(preset.audioFormat),
    sampleRate: variantKey(preset.sampleRate),
    toolsEnabled: {
      webSearch: Boolean(preset.toolsEnabled?.webSearch),
      xSearch: Boolean(preset.toolsEnabled?.xSearch),
      functionCalling: Boolean(preset.toolsEnabled?.functionCalling),
    },
    captureOptions: {
      saveTranscript: Boolean(preset.captureOptions?.saveTranscript),
      recordAudio: Boolean(preset.captureOptions?.recordAudio),
      consentConfirmed: Boolean(preset.captureOptions?.consentConfirmed),
    },
    enabled: Boolean(preset.enabled),
    verificationStatus: variantKey(preset.verificationStatus),
    webhookSecret: preset.webhookSecret,
    createdAt: preset.createdAt,
    updatedAt: preset.updatedAt,
    verifiedAt: unwrapOptional(preset.verifiedAt),
    lastIncomingAt: unwrapOptional(preset.lastIncomingAt),
  };
}

export function normalizeCallPreset(preset) {
  if (!preset) return null;
  return {
    id: preset.id.toString(),
    ownerId: preset.ownerId.toText(),
    name: preset.name,
    systemPrompt: preset.systemPrompt,
    voice: variantKey(preset.voice),
    voiceId: unwrapOptional(preset.voiceId),
    turnDetection: {
      serverVad: preset.turnDetection.serverVad,
      threshold: Number(preset.turnDetection.threshold ?? 0.5),
      silenceDurationMs: Number(preset.turnDetection.silenceDurationMs ?? 500),
      prefixPaddingMs: Number(preset.turnDetection.prefixPaddingMs ?? 200),
    },
    audioFormat: variantKey(preset.audioFormat),
    sampleRate: variantKey(preset.sampleRate),
    toolsEnabled: {
      webSearch: Boolean(preset.toolsEnabled?.webSearch),
      xSearch: Boolean(preset.toolsEnabled?.xSearch),
      functionCalling: Boolean(preset.toolsEnabled?.functionCalling),
    },
  };
}

export function normalizeAnsweringLiveSession(session) {
  return {
    sessionId: session.sessionId,
    monitorToken: session.monitorToken,
    callSid: session.callSid,
    userId: session.userId.toText(),
    answeringPresetId: session.answeringPresetId.toString(),
    answeringPresetName: session.answeringPresetName,
    callerPhone: session.callerPhone,
    startedAt: session.startedAt,
    allowedSeconds: Number(session.allowedSeconds),
  };
}

export function okOrThrow(result, message) {
  const kind = variantKey(result);
  if (kind === "ok") return result.ok;
  throw new Error(result?.err || message);
}
