import { type CallStatus, createActor } from "@/backend";
import type {
  AnsweringPresetInput,
  AnsweringPresetMutationResult,
  BillingMutationResult,
  BillingStatus,
  CallId,
  CreatePurchaseIntentResult,
  EphemeralTokenResult,
  InitiateCallInput,
  InitiateCallResult,
  PresetId,
  ReserveCallResult,
  TwilioLineInput,
  TwilioLineMutationResult,
} from "@/backend";
import type {
  AdminConfig,
  AnsweringLiveSession,
  AnsweringPreset,
  CallPreset,
  CallPresetInput,
  CallRecordPublic,
  SystemLog,
  TwilioLine,
  UserRole,
} from "@/types";
import { useActor } from "@caffeineai/core-infrastructure";
import type { Principal } from "@icp-sdk/core/principal";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

function useBackendActor() {
  return useActor(createActor);
}

function compareBigIntDesc(a: bigint, b: bigint): number {
  if (a === b) return 0;
  return a > b ? -1 : 1;
}

function sortCallsNewestFirst(calls: CallRecordPublic[]): CallRecordPublic[] {
  return [...calls].sort((a, b) => {
    const byStart = compareBigIntDesc(a.startTime, b.startTime);
    return byStart || compareBigIntDesc(a.id, b.id);
  });
}

function sortLogsNewestFirst(logs: SystemLog[]): SystemLog[] {
  return [...logs].sort((a, b) => compareBigIntDesc(a.timestamp, b.timestamp));
}

export function useListMyPresets() {
  const { actor, isFetching } = useBackendActor();
  return useQuery<CallPreset[]>({
    queryKey: ["myPresets"],
    queryFn: async () => {
      if (!actor) return [];
      return actor.listMyPresets();
    },
    enabled: !!actor && !isFetching,
  });
}

export function useGetPreset(id: PresetId | null) {
  const { actor, isFetching } = useBackendActor();
  return useQuery<CallPreset | null>({
    queryKey: ["preset", id?.toString()],
    queryFn: async () => {
      if (!actor || id === null) return null;
      return actor.getPreset(id);
    },
    enabled: !!actor && !isFetching && id !== null,
  });
}

export function useCreatePreset() {
  const { actor } = useBackendActor();
  const qc = useQueryClient();
  return useMutation<CallPreset, Error, CallPresetInput>({
    mutationFn: async (input) => {
      if (!actor) throw new Error("Actor not available");
      return actor.createPreset(input);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["myPresets"] }),
  });
}

export function useUpdatePreset() {
  const { actor } = useBackendActor();
  const qc = useQueryClient();
  return useMutation<
    CallPreset | null,
    Error,
    { id: PresetId; input: CallPresetInput }
  >({
    mutationFn: async ({ id, input }) => {
      if (!actor) throw new Error("Actor not available");
      return actor.updatePreset(id, input);
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["myPresets"] });
      qc.invalidateQueries({ queryKey: ["preset", vars.id.toString()] });
    },
  });
}

export function useDeletePreset() {
  const { actor } = useBackendActor();
  const qc = useQueryClient();
  return useMutation<boolean, Error, PresetId>({
    mutationFn: async (id) => {
      if (!actor) throw new Error("Actor not available");
      return actor.deletePreset(id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["myPresets"] }),
  });
}

export function useDuplicatePreset() {
  const { actor } = useBackendActor();
  const qc = useQueryClient();
  return useMutation<CallPreset | null, Error, PresetId>({
    mutationFn: async (id) => {
      if (!actor) throw new Error("Actor not available");
      return actor.duplicatePreset(id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["myPresets"] }),
  });
}

export function useListMyAnsweringPresets() {
  const { actor, isFetching } = useBackendActor();
  return useQuery<AnsweringPreset[]>({
    queryKey: ["myAnsweringPresets"],
    queryFn: async () => {
      if (!actor) return [];
      return actor.listMyAnsweringPresets();
    },
    enabled: !!actor && !isFetching,
    refetchInterval: 5000,
  });
}

export function useCreateAnsweringPreset() {
  const { actor } = useBackendActor();
  const qc = useQueryClient();
  return useMutation<
    AnsweringPresetMutationResult,
    Error,
    AnsweringPresetInput
  >({
    mutationFn: async (input) => {
      if (!actor) throw new Error("Actor not available");
      return actor.createAnsweringPreset(input);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["myAnsweringPresets"] }),
  });
}

export function useUpdateAnsweringPreset() {
  const { actor } = useBackendActor();
  const qc = useQueryClient();
  return useMutation<
    AnsweringPresetMutationResult,
    Error,
    { id: PresetId; input: AnsweringPresetInput }
  >({
    mutationFn: async ({ id, input }) => {
      if (!actor) throw new Error("Actor not available");
      return actor.updateAnsweringPreset(id, input);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["myAnsweringPresets"] }),
  });
}

export function useDeleteAnsweringPreset() {
  const { actor } = useBackendActor();
  const qc = useQueryClient();
  return useMutation<boolean, Error, PresetId>({
    mutationFn: async (id) => {
      if (!actor) throw new Error("Actor not available");
      return actor.deleteAnsweringPreset(id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["myAnsweringPresets"] }),
  });
}

export function useSetAnsweringPresetEnabled() {
  const { actor } = useBackendActor();
  const qc = useQueryClient();
  return useMutation<
    AnsweringPresetMutationResult,
    Error,
    { id: PresetId; enabled: boolean }
  >({
    mutationFn: async ({ id, enabled }) => {
      if (!actor) throw new Error("Actor not available");
      return actor.setAnsweringPresetEnabled(id, enabled);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["myAnsweringPresets"] }),
  });
}

export function useListMyAnsweringLiveSessions() {
  const { actor, isFetching } = useBackendActor();
  return useQuery<AnsweringLiveSession[]>({
    queryKey: ["myAnsweringLiveSessions"],
    queryFn: async () => {
      if (!actor) return [];
      return actor.listMyAnsweringLiveSessions();
    },
    enabled: !!actor && !isFetching,
    refetchInterval: 3000,
  });
}

export function useListMyCalls() {
  const { actor, isFetching } = useBackendActor();
  return useQuery<CallRecordPublic[]>({
    queryKey: ["myCalls"],
    queryFn: async () => {
      if (!actor) return [];
      return sortCallsNewestFirst(await actor.listMyCalls());
    },
    enabled: !!actor && !isFetching,
    refetchInterval: 5000,
  });
}

export function useGetCallRecord(id: CallId | null) {
  const { actor, isFetching } = useBackendActor();
  return useQuery<CallRecordPublic | null>({
    queryKey: ["callRecord", id?.toString()],
    queryFn: async () => {
      if (!actor || id === null) return null;
      return actor.getCallRecord(id);
    },
    enabled: !!actor && !isFetching && id !== null,
    refetchInterval: 3000,
  });
}

export function useInitiateCall() {
  const { actor } = useBackendActor();
  const qc = useQueryClient();
  return useMutation<InitiateCallResult, Error, InitiateCallInput>({
    mutationFn: async (input) => {
      if (!actor) throw new Error("Actor not available");
      return actor.initiateCall(input);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["myCalls"] }),
  });
}

export function useGetMyBillingStatus() {
  const { actor, isFetching } = useBackendActor();
  return useQuery<BillingStatus | null>({
    queryKey: ["myBillingStatus"],
    queryFn: async () => {
      if (!actor) return null;
      return actor.getMyBillingStatus();
    },
    enabled: !!actor && !isFetching,
    refetchInterval: 10_000,
  });
}

export function useCreatePurchaseIntent() {
  const { actor } = useBackendActor();
  return useMutation<CreatePurchaseIntentResult, Error, string>({
    mutationFn: async (packageId) => {
      if (!actor) throw new Error("Actor not available");
      return actor.createPurchaseIntent(packageId);
    },
  });
}

export function useReserveCall() {
  const { actor } = useBackendActor();
  const qc = useQueryClient();
  return useMutation<ReserveCallResult, Error, InitiateCallInput>({
    mutationFn: async (input) => {
      if (!actor) throw new Error("Actor not available");
      return actor.reserveCall(input);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["myCalls"] });
      qc.invalidateQueries({ queryKey: ["myBillingStatus"] });
    },
  });
}

export function useGetEphemeralToken() {
  const { actor } = useBackendActor();
  return useMutation<EphemeralTokenResult, Error, PresetId>({
    mutationFn: async (presetId) => {
      if (!actor) throw new Error("Actor not available");
      return actor.getEphemeralToken(presetId);
    },
  });
}

export function useAdminGetSystemLogs(limit = 100n) {
  const { actor, isFetching } = useBackendActor();
  return useQuery<SystemLog[]>({
    queryKey: ["adminLogs", limit.toString()],
    queryFn: async () => {
      if (!actor) return [];
      return sortLogsNewestFirst(await actor.adminGetSystemLogs(limit));
    },
    enabled: !!actor && !isFetching,
    refetchInterval: 10_000,
  });
}

export function useAdminListAllCalls() {
  const { actor, isFetching } = useBackendActor();
  return useQuery<CallRecordPublic[]>({
    queryKey: ["adminAllCalls"],
    queryFn: async () => {
      if (!actor) return [];
      return sortCallsNewestFirst(await actor.adminListAllCalls());
    },
    enabled: !!actor && !isFetching,
    refetchInterval: 10_000,
  });
}

export function useAdminListUserCalls(userId: Principal | null) {
  const { actor, isFetching } = useBackendActor();
  return useQuery<CallRecordPublic[]>({
    queryKey: ["adminUserCalls", userId?.toString()],
    queryFn: async () => {
      if (!actor || !userId) return [];
      return sortCallsNewestFirst(await actor.adminListUserCalls(userId));
    },
    enabled: !!actor && !isFetching && userId !== null,
  });
}

export function useGetAdminConfig() {
  const { actor, isFetching } = useBackendActor();
  return useQuery<AdminConfig>({
    queryKey: ["adminConfig"],
    queryFn: async () => {
      if (!actor) throw new Error("Actor not available");
      return actor.getAdminConfig();
    },
    enabled: !!actor && !isFetching,
  });
}

export function useSetAdminConfig() {
  const { actor } = useBackendActor();
  const qc = useQueryClient();
  return useMutation<
    void,
    Error,
    {
      xaiApiKey: string;
      twilioAccountSid: string;
      twilioAuthToken: string;
      twilioFromNumber: string;
    }
  >({
    mutationFn: async ({
      xaiApiKey,
      twilioAccountSid,
      twilioAuthToken,
      twilioFromNumber,
    }) => {
      if (!actor) throw new Error("Actor not available");
      return actor.setAdminConfig(
        xaiApiKey,
        twilioAccountSid,
        twilioAuthToken,
        twilioFromNumber,
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["adminConfig"] }),
  });
}

export function useSetTwilioLine() {
  const { actor } = useBackendActor();
  const qc = useQueryClient();
  return useMutation<TwilioLineMutationResult, Error, TwilioLineInput>({
    mutationFn: async (input) => {
      if (!actor) throw new Error("Actor not available");
      return actor.setTwilioLine(input);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["adminConfig"] }),
  });
}

export function useRemoveTwilioLine() {
  const { actor } = useBackendActor();
  const qc = useQueryClient();
  return useMutation<TwilioLineMutationResult, Error, string>({
    mutationFn: async (phoneNumber) => {
      if (!actor) throw new Error("Actor not available");
      return actor.removeTwilioLine(phoneNumber);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["adminConfig"] }),
  });
}

export function useSetTwilioLineEnabled() {
  const { actor } = useBackendActor();
  const qc = useQueryClient();
  return useMutation<
    TwilioLineMutationResult,
    Error,
    Pick<TwilioLine, "phoneNumber" | "enabled">
  >({
    mutationFn: async ({ phoneNumber, enabled }) => {
      if (!actor) throw new Error("Actor not available");
      return actor.setTwilioLineEnabled(phoneNumber, enabled);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["adminConfig"] }),
  });
}

export function useUpdateCallStatus() {
  const { actor } = useBackendActor();
  const qc = useQueryClient();
  return useMutation<
    boolean,
    Error,
    { callId: CallId; status: CallStatus; transcript: string | null }
  >({
    mutationFn: async ({ callId, status, transcript }) => {
      if (!actor) throw new Error("Actor not available");
      return actor.updateCallStatus(callId, status, transcript);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["myCalls"] });
      qc.invalidateQueries({ queryKey: ["adminAllCalls"] });
    },
  });
}

export function useAssignUserRole() {
  const { actor } = useBackendActor();
  return useMutation<void, Error, { user: Principal; role: UserRole }>({
    mutationFn: async ({ user, role }) => {
      if (!actor) throw new Error("Actor not available");
      return actor.assignCallerUserRole(user, role);
    },
  });
}

export function useAdminAddPromoMinutes() {
  const { actor } = useBackendActor();
  const qc = useQueryClient();
  return useMutation<
    BillingMutationResult,
    Error,
    { user: Principal; minutes: bigint }
  >({
    mutationFn: async ({ user, minutes }) => {
      if (!actor) throw new Error("Actor not available");
      return actor.adminAddPromoMinutes(user, minutes);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["myBillingStatus"] });
      qc.invalidateQueries({ queryKey: ["adminLogs"] });
    },
  });
}
