import type { CallStatus } from "@/types";
import { create } from "zustand";

interface CallStore {
  activeCallId: bigint | null;
  callStatus: CallStatus | null;
  recipient: string;
  presetId: bigint | null;
  setActiveCall: (callId: bigint, recipient: string, presetId: bigint) => void;
  setCallStatus: (status: CallStatus) => void;
  clearCall: () => void;
}

export const useCallStore = create<CallStore>((set) => ({
  activeCallId: null,
  callStatus: null,
  recipient: "",
  presetId: null,
  setActiveCall: (callId, recipient, presetId) =>
    set({
      activeCallId: callId,
      callStatus: "inProgress" as CallStatus,
      recipient,
      presetId,
    }),
  setCallStatus: (status) => set({ callStatus: status }),
  clearCall: () =>
    set({
      activeCallId: null,
      callStatus: null,
      recipient: "",
      presetId: null,
    }),
}));
