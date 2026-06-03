import type { Principal } from "@icp-sdk/core/principal";
export interface Some<T> {
    __kind__: "Some";
    value: T;
}
export interface None {
    __kind__: "None";
}
export type Option<T> = Some<T> | None;
export interface CallRecordPublic {
    id: bigint;
    startTime: bigint;
    status: CallStatus;
    endTime?: bigint;
    userId: Principal;
    recipientPhone: string;
    callSid?: string;
    presetId: bigint;
    transcript?: string;
}
export type CallId = bigint;
export interface TurnDetection {
    prefixPaddingMs: bigint;
    threshold: number;
    silenceDurationMs: bigint;
    serverVad: boolean;
}
export type PresetId = bigint;
export interface CallPreset {
    id: bigint;
    toolsEnabled: ToolsEnabled;
    ownerId: Principal;
    voice: Voice;
    voiceId?: string;
    name: string;
    sampleRate: SampleRate;
    systemPrompt: string;
    turnDetection: TurnDetection;
    audioFormat: AudioFormat;
}
export interface SystemLog {
    level: Variant_info_warn_error;
    message: string;
    timestamp: bigint;
    callId?: bigint;
}
export type InitiateCallResult = {
    __kind__: "ok";
    ok: {
        callSid: string;
        callId: bigint;
    };
} | {
    __kind__: "err";
    err: string;
};
export interface TwilioLine {
    enabled: boolean;
    name: string;
    phoneNumber: string;
}
export interface TwilioLineInput {
    enabled: boolean;
    name: string;
    phoneNumber: string;
}
export type TwilioLineMutationResult = {
    __kind__: "ok";
    ok: Array<TwilioLine>;
} | {
    __kind__: "err";
    err: string;
};
export interface InitiateCallInput {
    recipientPhone: string;
    presetId: bigint;
}
export interface CallPresetInput {
    toolsEnabled: ToolsEnabled;
    voice: Voice;
    voiceId?: string;
    name: string;
    sampleRate: SampleRate;
    systemPrompt: string;
    turnDetection: TurnDetection;
    audioFormat: AudioFormat;
}
export interface ToolsEnabled {
    xSearch: boolean;
    webSearch: boolean;
    functionCalling: boolean;
}
export enum AudioFormat {
    pcm = "pcm",
    pcma = "pcma",
    pcmu = "pcmu"
}
export enum CallStatus {
    pending = "pending",
    completed = "completed",
    inProgress = "inProgress",
    failed = "failed"
}
export enum SampleRate {
    hz16000 = "hz16000",
    hz32000 = "hz32000",
    hz22050 = "hz22050",
    hz24000 = "hz24000",
    hz44100 = "hz44100",
    hz48000 = "hz48000",
    hz8000 = "hz8000"
}
export enum UserRole {
    admin = "admin",
    user = "user",
    guest = "guest"
}
export enum Variant_info_warn_error {
    info = "info",
    warn = "warn",
    error = "error"
}
export enum Voice {
    ara = "ara",
    eve = "eve",
    leo = "leo",
    rex = "rex",
    sal = "sal"
}
export interface backendInterface {
    adminGetSystemLogs(limit: bigint): Promise<Array<SystemLog>>;
    adminListAllCalls(): Promise<Array<CallRecordPublic>>;
    adminListUserCalls(userId: Principal): Promise<Array<CallRecordPublic>>;
    assignCallerUserRole(user: Principal, role: UserRole): Promise<void>;
    createPreset(input: CallPresetInput): Promise<CallPreset>;
    deletePreset(id: PresetId): Promise<boolean>;
    duplicatePreset(id: PresetId): Promise<CallPreset | null>;
    getAdminConfig(): Promise<{
        hasXaiKey: boolean;
        hasTwilioAuth: boolean;
        twilioFromNumber: string;
        twilioAccountSid: string;
        twilioPhoneNumbers: Array<TwilioLine>;
    }>;
    getCallRecord(id: CallId): Promise<CallRecordPublic | null>;
    getCallerUserRole(): Promise<UserRole>;
    getPreset(id: PresetId): Promise<CallPreset | null>;
    initiateCall(input: InitiateCallInput): Promise<InitiateCallResult>;
    isCallerAdmin(): Promise<boolean>;
    listMyCalls(): Promise<Array<CallRecordPublic>>;
    listMyPresets(): Promise<Array<CallPreset>>;
    setAdminConfig(xaiApiKey: string, twilioAccountSid: string, twilioAuthToken: string, twilioFromNumber: string): Promise<void>;
    setTwilioLine(input: TwilioLineInput): Promise<TwilioLineMutationResult>;
    removeTwilioLine(phoneNumber: string): Promise<TwilioLineMutationResult>;
    setTwilioLineEnabled(phoneNumber: string, enabled: boolean): Promise<TwilioLineMutationResult>;
    twilioWebhook(callSid: string, callStatus: string): Promise<string>;
    updateCallStatus(callId: CallId, status: CallStatus, transcript: string | null): Promise<boolean>;
    updatePreset(id: PresetId, input: CallPresetInput): Promise<CallPreset | null>;
}
