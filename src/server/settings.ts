import { settings } from '@devvit/settings';

export type WholesomeShieldSettings = {
  automatic_moderation: boolean;
  remove_unsafe_content: boolean;
  leave_warning_comment: boolean;
  send_private_warning: boolean;
  ban_repeat_violators: boolean;
  notify_moderators: boolean;
  scan_limit: number;
};

export const DEFAULT_WHOLESOME_SHIELD_SETTINGS: WholesomeShieldSettings = {
  automatic_moderation: true,
  remove_unsafe_content: true,
  leave_warning_comment: true,
  send_private_warning: true,
  ban_repeat_violators: true,
  notify_moderators: false,
  scan_limit: 50,
};

export async function getWholesomeShieldSettings(): Promise<WholesomeShieldSettings> {
  try {
    const values = await settings.getAll<Partial<WholesomeShieldSettings>>();
    return normalizeWholesomeShieldSettings(values);
  } catch (error) {
    console.error('WholesomeShield could not read installation settings; using defaults.', error);
    return DEFAULT_WHOLESOME_SHIELD_SETTINGS;
  }
}

export function normalizeWholesomeShieldSettings(
  values: Partial<WholesomeShieldSettings> = {}
): WholesomeShieldSettings {
  return {
    automatic_moderation: booleanOrDefault(
      values.automatic_moderation,
      DEFAULT_WHOLESOME_SHIELD_SETTINGS.automatic_moderation
    ),
    remove_unsafe_content: booleanOrDefault(
      values.remove_unsafe_content,
      DEFAULT_WHOLESOME_SHIELD_SETTINGS.remove_unsafe_content
    ),
    leave_warning_comment: booleanOrDefault(
      values.leave_warning_comment,
      DEFAULT_WHOLESOME_SHIELD_SETTINGS.leave_warning_comment
    ),
    send_private_warning: booleanOrDefault(
      values.send_private_warning,
      DEFAULT_WHOLESOME_SHIELD_SETTINGS.send_private_warning
    ),
    ban_repeat_violators: booleanOrDefault(
      values.ban_repeat_violators,
      DEFAULT_WHOLESOME_SHIELD_SETTINGS.ban_repeat_violators
    ),
    notify_moderators: booleanOrDefault(
      values.notify_moderators,
      DEFAULT_WHOLESOME_SHIELD_SETTINGS.notify_moderators
    ),
    scan_limit: clampScanLimit(values.scan_limit),
  };
}

function booleanOrDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function clampScanLimit(value: unknown): number {
  const numericValue = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 50;
  return Math.max(1, Math.min(numericValue, 100));
}
