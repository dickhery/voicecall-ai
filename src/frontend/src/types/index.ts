import type {
  AudioFormat,
  CallPreset,
  CallPresetInput,
  CallRecordPublic,
  CallStatus,
  SampleRate,
  SystemLog,
  ToolsEnabled,
  TurnDetection,
  TwilioLine,
  TwilioLineInput,
  UserRole,
  Voice,
} from "@/backend";
import type { Principal } from "@icp-sdk/core/principal";

export type {
  CallPreset,
  CallPresetInput,
  CallRecordPublic,
  CallStatus,
  SystemLog,
  UserRole,
  Voice,
  AudioFormat,
  SampleRate,
  TurnDetection,
  ToolsEnabled,
  TwilioLine,
  TwilioLineInput,
};

export type { Principal };

export interface AdminConfig {
  hasXaiKey: boolean;
  hasTwilioAuth: boolean;
  twilioFromNumber: string;
  twilioAccountSid: string;
  twilioPhoneNumbers: TwilioLine[];
}

export interface CallActiveState {
  activeCallId: bigint | null;
  callStatus: CallStatus | null;
  recipient: string;
  presetId: bigint | null;
}

export interface NavItem {
  label: string;
  href: string;
  icon: string;
  adminOnly?: boolean;
}
