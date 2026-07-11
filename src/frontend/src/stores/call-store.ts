import type { CallStatus } from "@/types";
import { create } from "zustand";

const PERSIST_KEY = "voicecall.activeSession";

export interface PersistedCallSession {
  callId: string;
  sessionId: string;
  monitorToken: string;
  callSid: string;
  recipient: string;
  presetId: string;
  presetName: string;
  allowedSeconds: number;
  status: "queued" | "connecting" | "in_call";
  startedAt: number;
}

interface CallStore {
  activeCallId: bigint | null;
  callStatus: CallStatus | null;
  recipient: string;
  presetId: bigint | null;
  sessionId: string | null;
  monitorToken: string | null;
  callSid: string | null;
  presetName: string;
  allowedSeconds: number;
  remainingSeconds: number | null;
  setActiveCall: (callId: bigint, recipient: string, presetId: bigint) => void;
  setCallStatus: (status: CallStatus) => void;
  setSessionMeta: (meta: {
    sessionId?: string | null;
    monitorToken?: string | null;
    callSid?: string | null;
    presetName?: string;
    allowedSeconds?: number;
    remainingSeconds?: number | null;
    voiceStatus?: PersistedCallSession["status"];
  }) => void;
  persistActiveSession: () => void;
  clearCall: () => void;
  hydrateFromStorage: () => PersistedCallSession | null;
}

function readPersisted(): PersistedCallSession | null {
  try {
    const raw = sessionStorage.getItem(PERSIST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedCallSession;
    if (!parsed?.sessionId || !parsed?.monitorToken) return null;
    // Drop stale sessions older than 3 hours
    if (Date.now() - Number(parsed.startedAt || 0) > 3 * 60 * 60 * 1000) {
      sessionStorage.removeItem(PERSIST_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writePersisted(session: PersistedCallSession | null) {
  try {
    if (!session) {
      sessionStorage.removeItem(PERSIST_KEY);
      return;
    }
    sessionStorage.setItem(PERSIST_KEY, JSON.stringify(session));
  } catch {
    // Ignore storage failures
  }
}

export const useCallStore = create<CallStore>((set, get) => ({
  activeCallId: null,
  callStatus: null,
  recipient: "",
  presetId: null,
  sessionId: null,
  monitorToken: null,
  callSid: null,
  presetName: "",
  allowedSeconds: 0,
  remainingSeconds: null,

  setActiveCall: (callId, recipient, presetId) =>
    set({
      activeCallId: callId,
      callStatus: "inProgress" as CallStatus,
      recipient,
      presetId,
    }),

  setCallStatus: (status) => set({ callStatus: status }),

  setSessionMeta: (meta) => {
    set((state) => ({
      sessionId:
        meta.sessionId !== undefined ? meta.sessionId : state.sessionId,
      monitorToken:
        meta.monitorToken !== undefined
          ? meta.monitorToken
          : state.monitorToken,
      callSid: meta.callSid !== undefined ? meta.callSid : state.callSid,
      presetName:
        meta.presetName !== undefined ? meta.presetName : state.presetName,
      allowedSeconds:
        meta.allowedSeconds !== undefined
          ? meta.allowedSeconds
          : state.allowedSeconds,
      remainingSeconds:
        meta.remainingSeconds !== undefined
          ? meta.remainingSeconds
          : state.remainingSeconds,
    }));
    get().persistActiveSession();
  },

  persistActiveSession: () => {
    const state = get();
    if (!state.sessionId || !state.monitorToken || !state.activeCallId) {
      return;
    }
    const voiceStatus: PersistedCallSession["status"] =
      state.callSid || state.callStatus === "inProgress"
        ? "in_call"
        : "queued";
    writePersisted({
      callId: state.activeCallId.toString(),
      sessionId: state.sessionId,
      monitorToken: state.monitorToken,
      callSid: state.callSid || "",
      recipient: state.recipient,
      presetId: state.presetId?.toString() ?? "",
      presetName: state.presetName,
      allowedSeconds: state.allowedSeconds,
      status: voiceStatus,
      startedAt: Date.now(),
    });
  },

  clearCall: () => {
    writePersisted(null);
    set({
      activeCallId: null,
      callStatus: null,
      recipient: "",
      presetId: null,
      sessionId: null,
      monitorToken: null,
      callSid: null,
      presetName: "",
      allowedSeconds: 0,
      remainingSeconds: null,
    });
  },

  hydrateFromStorage: () => readPersisted(),
}));
