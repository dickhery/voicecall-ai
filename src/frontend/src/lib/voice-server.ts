import type { CallPreset } from "@/types";

interface RuntimeEnv {
  voice_server_url?: string;
}

export interface VoiceServerCall {
  callSid: string;
  sessionId: string;
  status?: string;
}

export interface VoiceServerHealth {
  ok: boolean;
  publicHost: string;
  twilioConfigured: boolean;
  xaiConfigured: boolean;
  model: string;
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

export async function startVoiceServerCall({
  recipientPhone,
  preset,
  callId,
}: {
  recipientPhone: string;
  preset: CallPreset;
  callId: bigint;
}): Promise<VoiceServerCall> {
  return postJson<VoiceServerCall>("/initiate-call", {
    recipientPhone,
    preset: serializePreset(preset),
    callId: callId.toString(),
  });
}

export async function endVoiceServerCall(callSid: string): Promise<void> {
  await postJson<{ ok: true }>("/end-call", { callSid });
}

export async function getVoiceServerHealth(): Promise<VoiceServerHealth> {
  const baseUrl = await getVoiceServerUrl();
  const response = await fetch(`${baseUrl}/health`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Voice server health check failed (${response.status})`);
  }
  return response.json();
}
