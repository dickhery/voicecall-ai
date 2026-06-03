import type { CallPreset } from "@/types";

interface RuntimeEnv {
  voice_server_url?: string;
}

export interface VoiceServerCall {
  callSid: string;
  sessionId: string;
  monitorToken?: string;
  status?: string;
  queued?: boolean;
  queuePosition?: number;
  allowedSeconds?: number;
  liveAudio?: {
    codec: "audio/pcmu";
    sampleRate: 8000;
  } | null;
}

export interface CallCaptureOptions {
  saveTranscript: boolean;
  recordAudio: boolean;
  permissionConfirmed: boolean;
}

export interface VoiceServerHealth {
  ok: boolean;
  publicHost?: string;
  twilioConfigured: boolean;
  twilioLines?: {
    configured: number;
    active: number;
    available: number;
    queued: number;
    numbers?: string[];
  };
  cors?: {
    requestOriginAllowed: boolean;
  };
  xaiConfigured: boolean;
  billingConfigured?: boolean;
  backendCanisterId?: string;
  backendHost?: string;
  icpServerPrincipal?: string;
  model?: string;
}

export interface XaiVoiceOption {
  voiceId: string;
  name: string;
  description?: string;
  type?: string;
  gender?: string;
  tone?: string;
}

export interface XaiVoiceLibraryResponse {
  ok: true;
  source: "xai" | "fallback";
  voices: XaiVoiceOption[];
  warning?: string;
}

export interface XaiVoicePreviewResponse {
  ok: true;
  voiceId: string;
  contentType: "audio/wav";
  audioBase64: string;
}

export interface CheckoutSessionResponse {
  ok: true;
  id: string;
  url: string;
}

export interface RecordingAccessResponse {
  ok: true;
  url: string;
}

let runtimeEnvPromise: Promise<RuntimeEnv> | null = null;

async function loadRuntimeEnv(): Promise<RuntimeEnv> {
  if (!runtimeEnvPromise) {
    runtimeEnvPromise = fetch("/env.json", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : {}))
      .catch(() => ({}));
  }
  return runtimeEnvPromise;
}

function normalizeServerUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^(localhost|127\.0\.0\.1|\[::1\])/i.test(trimmed)) {
    return `http://${trimmed}`;
  }
  return `https://${trimmed}`;
}

export async function getVoiceServerUrl(): Promise<string> {
  const buildTimeUrl = import.meta.env.VITE_VOICE_SERVER_URL as
    | string
    | undefined;
  const runtimeEnv = await loadRuntimeEnv();
  const url = buildTimeUrl || runtimeEnv.voice_server_url;

  if (!url || url === "undefined") {
    throw new Error(
      "Voice server URL is not configured. Set voice_server_url in src/frontend/env.json.",
    );
  }

  return normalizeServerUrl(url);
}

function serializePreset(preset: CallPreset) {
  return {
    id: preset.id.toString(),
    name: preset.name,
    systemPrompt: preset.systemPrompt,
    voice: preset.voice,
    voiceId: preset.voiceId ?? null,
    audioFormat: preset.audioFormat,
    sampleRate: preset.sampleRate,
    turnDetection: {
      serverVad: preset.turnDetection.serverVad,
      threshold: preset.turnDetection.threshold,
      silenceDurationMs: Number(preset.turnDetection.silenceDurationMs),
      prefixPaddingMs: Number(preset.turnDetection.prefixPaddingMs),
    },
    toolsEnabled: preset.toolsEnabled,
  };
}

async function getJson<T>(path: string): Promise<T> {
  const baseUrl = await getVoiceServerUrl();
  const response = await fetch(`${baseUrl}${path}`);
  const payload = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
  };

  if (!response.ok || payload.ok === false) {
    throw new Error(
      payload.error || `Voice server request failed (${response.status})`,
    );
  }

  return payload as T;
}

async function postJson<T>(
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const baseUrl = await getVoiceServerUrl();
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
  };

  if (!response.ok || payload.ok === false) {
    throw new Error(
      payload.error || `Voice server request failed (${response.status})`,
    );
  }

  return payload as T;
}

export async function listXaiVoiceLibrary(): Promise<XaiVoiceLibraryResponse> {
  return getJson<XaiVoiceLibraryResponse>("/xai/voices");
}

export async function previewXaiVoice({
  voiceId,
  text,
}: {
  voiceId: string;
  text?: string;
}): Promise<XaiVoicePreviewResponse> {
  return postJson<XaiVoicePreviewResponse>("/xai/voice-preview", {
    voiceId,
    text,
  });
}

export async function startVoiceServerCall({
  recipientPhone,
  preset,
  callId,
  reservationId,
  callToken,
  captureOptions,
}: {
  recipientPhone: string;
  preset: CallPreset;
  callId: bigint;
  reservationId: string;
  callToken: string;
  captureOptions?: CallCaptureOptions;
}): Promise<VoiceServerCall> {
  return postJson<VoiceServerCall>("/initiate-call", {
    recipientPhone,
    preset: serializePreset(preset),
    callId: callId.toString(),
    reservationId,
    callToken,
    captureOptions,
  });
}

export async function endVoiceServerCall({
  callSid,
  sessionId,
  monitorToken,
}: {
  callSid?: string | null;
  sessionId?: string | null;
  monitorToken?: string | null;
}): Promise<void> {
  await postJson<{ ok: true }>("/end-call", { callSid, sessionId, monitorToken });
}

export async function steerVoiceServerCall({
  sessionId,
  monitorToken,
  prompt,
}: {
  sessionId: string;
  monitorToken: string;
  prompt: string;
}): Promise<void> {
  await postJson<{ ok: true }>("/steer-call", {
    sessionId,
    monitorToken,
    prompt,
  });
}

export async function getVoiceServerCallSession(
  sessionId: string,
  monitorToken: string,
): Promise<VoiceServerCall> {
  const baseUrl = await getVoiceServerUrl();
  const url = new URL(
    `/call-session/${encodeURIComponent(sessionId)}`,
    baseUrl,
  );
  url.searchParams.set("monitorToken", monitorToken);
  const response = await fetch(url.toString(), { cache: "no-store" });
  const payload = (await response.json().catch(() => ({}))) as
    | VoiceServerCall
    | { ok?: false; error?: string };

  if (!response.ok || ("ok" in payload && payload.ok === false)) {
    throw new Error(
      "error" in payload && payload.error
        ? payload.error
        : `Call session check failed (${response.status})`,
    );
  }

  return payload as VoiceServerCall;
}

export async function createCheckoutSession({
  purchaseIntentId,
  returnUrl,
}: {
  purchaseIntentId: string;
  returnUrl: string;
}): Promise<CheckoutSessionResponse> {
  return postJson<CheckoutSessionResponse>("/billing/create-checkout-session", {
    purchaseIntentId,
    returnUrl,
  });
}

export async function getVoiceServerHealth(): Promise<VoiceServerHealth> {
  const baseUrl = await getVoiceServerUrl();
  const response = await fetch(`${baseUrl}/health`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Voice server health check failed (${response.status})`);
  }
  return response.json();
}

export async function getLiveAudioMonitorUrl({
  sessionId,
  monitorToken,
}: {
  sessionId: string;
  monitorToken: string;
}): Promise<string> {
  const baseUrl = await getVoiceServerUrl();
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/monitor";
  url.search = "";
  url.searchParams.set("sessionId", sessionId);
  url.searchParams.set("token", monitorToken);
  return url.toString();
}

export async function getRecordingAccessUrl({
  recordingSid,
  callSid,
  monitorToken,
}: {
  recordingSid: string;
  callSid?: string | null;
  monitorToken?: string | null;
}): Promise<string> {
  const baseUrl = await getVoiceServerUrl();
  const url = new URL(`/recordings/${recordingSid}/access`, baseUrl);
  if (callSid) url.searchParams.set("callSid", callSid);
  if (monitorToken) url.searchParams.set("monitorToken", monitorToken);
  const response = await fetch(url.toString(), { cache: "no-store" });
  const payload = (await response.json().catch(() => ({}))) as
    | RecordingAccessResponse
    | { ok?: false; error?: string };
  const errorMessage = "error" in payload ? payload.error : undefined;

  if (!response.ok || payload.ok === false || !("url" in payload)) {
    throw new Error(
      errorMessage || `Recording access failed (${response.status})`,
    );
  }

  return payload.url;
}
