import { type CallStatus, createActor } from "@/backend";
import type {
  CallId,
  EphemeralTokenResult,
  InitiateCallInput,
  InitiateCallResult,
  PresetId,
} from "@/backend";
import type {
  AdminConfig,
  CallPreset,
  CallPresetInput,
  CallRecordPublic,
  SystemLog,
  UserRole,
} from "@/types";
import { useActor } from "@caffeineai/core-infrastructure";
import type { Principal } from "@icp-sdk/core/principal";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

function useBackendActor() {
  return useActor(createActor);
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

export function useListMyCalls() {
  const { actor, isFetching } = useBackendActor();
  return useQuery<CallRecordPublic[]>({
    queryKey: ["myCalls"],
    queryFn: async () => {
      if (!actor) return [];
      return actor.listMyCalls();
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
      return actor.adminGetSystemLogs(limit);
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
      return actor.adminListAllCalls();
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
      return actor.adminListUserCalls(userId);
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
