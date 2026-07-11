/**
 * Phone number helpers for E.164 validation, normalization, and display.
 */

const DEFAULT_COUNTRY_DIAL = "1";

/** Strip everything except digits and a leading +. */
export function stripPhoneInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  return hasPlus ? `+${digits}` : digits;
}

/**
 * Normalize user input toward E.164.
 * - Already-valid E.164 is returned cleaned
 * - 10-digit US/CA numbers become +1...
 * - 11-digit numbers starting with 1 become +1...
 * - Other pure digit strings get a leading +
 */
export function normalizeToE164(
  value: string,
  defaultCountryDial: string = DEFAULT_COUNTRY_DIAL,
): string {
  const stripped = stripPhoneInput(value);
  if (!stripped) return "";

  if (stripped.startsWith("+")) {
    return stripped;
  }

  const digits = stripped;
  if (digits.length === 10 && defaultCountryDial === "1") {
    return `+1${digits}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }
  if (digits.length >= 8 && digits.length <= 15) {
    return `+${digits}`;
  }
  return digits;
}

export function isValidE164(phone: string): boolean {
  return /^\+[1-9]\d{1,14}$/.test(phone.replace(/\s/g, ""));
}

/** Light display formatting for US numbers; otherwise return cleaned E.164. */
export function formatPhoneDisplay(phone: string): string {
  const cleaned = phone.replace(/\s/g, "");
  const us = cleaned.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  if (us) {
    return `+1 (${us[1]}) ${us[2]}-${us[3]}`;
  }
  return cleaned;
}

export function phoneInputHint(value: string): string | null {
  const cleaned = value.replace(/\s/g, "");
  if (!cleaned) return null;
  if (isValidE164(cleaned) || isValidE164(normalizeToE164(cleaned))) {
    return null;
  }
  if (/^\d{10}$/.test(cleaned)) {
    return "Looks like a US number — will dial as +1…";
  }
  return "Use international format, e.g. +15551234567";
}

const RECENT_PHONES_KEY = "voicecall.recentPhones";
const MAX_RECENT_PHONES = 8;

export function loadRecentPhones(): string[] {
  try {
    const raw = sessionStorage.getItem(RECENT_PHONES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === "string")
      .filter(isValidE164)
      .slice(0, MAX_RECENT_PHONES);
  } catch {
    return [];
  }
}

export function rememberRecentPhone(phone: string): void {
  if (!isValidE164(phone)) return;
  try {
    const existing = loadRecentPhones().filter((p) => p !== phone);
    const next = [phone, ...existing].slice(0, MAX_RECENT_PHONES);
    sessionStorage.setItem(RECENT_PHONES_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage failures (private mode, quota, etc.)
  }
}
