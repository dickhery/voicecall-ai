import type { backendInterface } from "../backend";
import {
  AudioFormat,
  CallStatus,
  CallReservationStatus,
  PurchaseIntentStatus,
  SampleRate,
  StripeMode,
  UserRole,
  Variant_info_warn_error,
  Voice,
} from "../backend";
import type { Principal } from "@icp-sdk/core/principal";

const samplePrincipal = {
  toText: () => "aaaaa-aa",
  toString: () => "aaaaa-aa",
  isAnonymous: () => false,
} as unknown as Principal;

const samplePreset = {
  id: BigInt(1),
  name: "Professional Sales Call",
  ownerId: samplePrincipal,
  voice: Voice.eve,
  systemPrompt:
    "You are a professional sales assistant. Greet the customer warmly, ask how you can assist them with their recent order, and guide them to relevant support articles if needed.",
  sampleRate: SampleRate.hz24000,
  audioFormat: AudioFormat.pcm,
  toolsEnabled: {
    xSearch: true,
    webSearch: false,
    functionCalling: true,
  },
  turnDetection: {
    prefixPaddingMs: BigInt(300),
    threshold: 0.5,
    silenceDurationMs: BigInt(800),
    serverVad: true,
  },
};

const samplePreset2 = {
  id: BigInt(2),
  name: "Customer Support",
  ownerId: samplePrincipal,
  voice: Voice.ara,
  systemPrompt:
    "You are a helpful customer support agent. Listen carefully and resolve issues efficiently.",
  sampleRate: SampleRate.hz16000,
  audioFormat: AudioFormat.pcmu,
  toolsEnabled: {
    xSearch: false,
    webSearch: true,
    functionCalling: false,
  },
  turnDetection: {
    prefixPaddingMs: BigInt(200),
    threshold: 0.6,
    silenceDurationMs: BigInt(600),
    serverVad: true,
  },
};

const sampleCallRecord = {
  id: BigInt(1),
  startTime: BigInt(Date.now() - 3600000),
  endTime: BigInt(Date.now() - 3600000 + 222000),
  status: CallStatus.completed,
  userId: samplePrincipal,
  recipientPhone: "+1 (555) 234-5678",
  callSid: "CA1234567890abcdef",
  presetId: BigInt(1),
  transcript:
    "Agent: Hello, how can I help you today?\nCustomer: I have a question about my order...",
};

const sampleCallRecord2 = {
  id: BigInt(2),
  startTime: BigInt(Date.now() - 1800000),
  status: CallStatus.inProgress,
  userId: samplePrincipal,
  recipientPhone: "+1 (555) 987-6543",
  callSid: "CA9876543210fedcba",
  presetId: BigInt(2),
};

export const mockBackend: backendInterface = {
  _initializeAccessControl: async () => undefined,
  adminAddPromoMinutes: async (_user: Principal, _minutes: bigint) => ({
    __kind__: "ok",
    ok: true,
  }),

  adminGetSystemLogs: async (_limit: bigint) => [
    {
      level: Variant_info_warn_error.info,
      message: "System initialized successfully",
      timestamp: BigInt(Date.now() - 3600000),
    },
    {
      level: Variant_info_warn_error.warn,
      message: "Twilio webhook received unknown status",
      timestamp: BigInt(Date.now() - 1800000),
      callId: BigInt(2),
    },
  ],

  adminListAllCalls: async () => [sampleCallRecord, sampleCallRecord2],

  adminListUserCalls: async (_userId: Principal) => [sampleCallRecord],

  assignCallerUserRole: async (_user: Principal, _role: UserRole) => undefined,

  cancelCallReservation: async (_reservationId: string, _reason: string) => ({
    __kind__: "ok",
    ok: true,
  }),

  createPreset: async (_input) => samplePreset,

  createPurchaseIntent: async (packageId: string) => ({
    __kind__: "ok",
    ok: {
      id: "pi_mock",
      user: samplePrincipal,
      packageId,
      amountCents: BigInt(packageId === "pack_20" ? 2000 : packageId === "pack_10" ? 1000 : 500),
      seconds: BigInt(packageId === "pack_20" ? 10800 : packageId === "pack_10" ? 5400 : 2700),
      mode: StripeMode.test,
      createdAt: BigInt(Date.now() * 1_000_000),
      status: PurchaseIntentStatus.pending,
    },
  }),

  deletePreset: async (_id: bigint) => true,

  duplicatePreset: async (_id: bigint) => samplePreset,

  getAdminConfig: async () => ({
    hasXaiKey: true,
    hasTwilioAuth: true,
    twilioFromNumber: "+1 (888) 555-0100",
    twilioAccountSid: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  }),

  getBillingPackages: async () => [
    { id: "pack_5", name: "$5 - 45 minutes", amountCents: 500n, seconds: 2700n },
    { id: "pack_10", name: "$10 - 90 minutes", amountCents: 1000n, seconds: 5400n },
    { id: "pack_20", name: "$20 - 180 minutes", amountCents: 2000n, seconds: 10800n },
  ],

  getCallRecord: async (_id: bigint) => sampleCallRecord,

  getCallerUserRole: async () => UserRole.admin,

  getEphemeralToken: async (_presetId: bigint) => ({
    __kind__: "ok",
    ok: {
      token: "ephemeral-token-sample-12345",
      websocketUrl: "wss://api.x.ai/v1/audio/speech/realtime",
    },
  }),

  getMyBillingStatus: async () => ({
    balanceSeconds: 5400n,
    reservedSeconds: 0n,
    availableSeconds: 5400n,
    packages: [
      { id: "pack_5", name: "$5 - 45 minutes", amountCents: 500n, seconds: 2700n },
      { id: "pack_10", name: "$10 - 90 minutes", amountCents: 1000n, seconds: 5400n },
      { id: "pack_20", name: "$20 - 180 minutes", amountCents: 2000n, seconds: 10800n },
    ],
  }),

  getPreset: async (_id: bigint) => samplePreset,

  initiateCall: async (_input) => ({
    __kind__: "ok",
    ok: {
      callSid: "CA1234567890abcdef",
      callId: BigInt(3),
    },
  }),

  isCallerAdmin: async () => true,

  listMyCalls: async () => [sampleCallRecord, sampleCallRecord2],

  listMyPresets: async () => [samplePreset, samplePreset2],

  reserveCall: async (input) => ({
    __kind__: "ok",
    ok: {
      id: "res_mock",
      callId: 3n,
      user: samplePrincipal,
      recipientPhone: input.recipientPhone,
      presetId: input.presetId,
      allowedSeconds: 5400n,
      callToken: "ct_mock",
      createdAt: BigInt(Date.now() * 1_000_000),
      expiresAt: BigInt((Date.now() + 15 * 60 * 1000) * 1_000_000),
      status: CallReservationStatus.reserved,
    },
  }),

  setAdminConfig: async (
    _xaiApiKey: string,
    _twilioAccountSid: string,
    _twilioAuthToken: string,
    _twilioFromNumber: string
  ) => undefined,

  transform: async (_input) => ({
    status: BigInt(200),
    body: new Uint8Array(),
    headers: [],
  }),

  twilioWebhook: async (_callSid: string, _callStatus: string) => "<Response/>",

  updateCallStatus: async (
    _callId: bigint,
    _status: CallStatus,
    _transcript: string | null
  ) => true,

  updatePreset: async (_id: bigint, _input) => samplePreset,
};
