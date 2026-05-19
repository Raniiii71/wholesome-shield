import { settings } from '@devvit/settings';

import { DEFAULT_CLEAN_POST_THANK_YOU_TEMPLATE } from './messages';

export type ModmailNotificationLevel = 'off' | 'bans_only' | 'all_violations';

export type WholesomeShieldSettings = {
  automatic_moderation: boolean;
  moderate_posts: boolean;
  moderate_comments: boolean;
  remove_unsafe_content: boolean;
  remove_reported_posts: boolean;
  report_removal_threshold: number;
  leave_warning_comment: boolean;
  send_private_warning: boolean;
  comment_on_clean_posts: boolean;
  clean_post_comment_message: string;
  ban_repeat_violators: boolean;
  modmail_notifications: ModmailNotificationLevel;
  include_profile_details_in_modmail: boolean;
  include_content_details_in_modmail: boolean;
  include_detection_details_in_modmail: boolean;
  scan_limit: number;
};

export const DEFAULT_WHOLESOME_SHIELD_SETTINGS: WholesomeShieldSettings = {
  automatic_moderation: true,
  moderate_posts: true,
  moderate_comments: true,
  remove_unsafe_content: true,
  remove_reported_posts: true,
  report_removal_threshold: 5,
  leave_warning_comment: true,
  send_private_warning: true,
  comment_on_clean_posts: true,
  clean_post_comment_message: DEFAULT_CLEAN_POST_THANK_YOU_TEMPLATE,
  ban_repeat_violators: true,
  modmail_notifications: 'all_violations',
  include_profile_details_in_modmail: true,
  include_content_details_in_modmail: true,
  include_detection_details_in_modmail: true,
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
    moderate_posts: booleanOrDefault(values.moderate_posts, DEFAULT_WHOLESOME_SHIELD_SETTINGS.moderate_posts),
    moderate_comments: booleanOrDefault(
      values.moderate_comments,
      DEFAULT_WHOLESOME_SHIELD_SETTINGS.moderate_comments
    ),
    remove_unsafe_content: booleanOrDefault(
      values.remove_unsafe_content,
      DEFAULT_WHOLESOME_SHIELD_SETTINGS.remove_unsafe_content
    ),
    remove_reported_posts: booleanOrDefault(
      values.remove_reported_posts,
      DEFAULT_WHOLESOME_SHIELD_SETTINGS.remove_reported_posts
    ),
    report_removal_threshold: clampNumberSetting(
      values.report_removal_threshold,
      DEFAULT_WHOLESOME_SHIELD_SETTINGS.report_removal_threshold
    ),
    leave_warning_comment: booleanOrDefault(
      values.leave_warning_comment,
      DEFAULT_WHOLESOME_SHIELD_SETTINGS.leave_warning_comment
    ),
    send_private_warning: booleanOrDefault(
      values.send_private_warning,
      DEFAULT_WHOLESOME_SHIELD_SETTINGS.send_private_warning
    ),
    comment_on_clean_posts: booleanOrDefault(
      values.comment_on_clean_posts,
      DEFAULT_WHOLESOME_SHIELD_SETTINGS.comment_on_clean_posts
    ),
    clean_post_comment_message: stringOrDefault(
      values.clean_post_comment_message,
      DEFAULT_WHOLESOME_SHIELD_SETTINGS.clean_post_comment_message
    ),
    ban_repeat_violators: booleanOrDefault(
      values.ban_repeat_violators,
      DEFAULT_WHOLESOME_SHIELD_SETTINGS.ban_repeat_violators
    ),
    modmail_notifications: modmailNotificationLevelOrDefault(values.modmail_notifications),
    include_profile_details_in_modmail: booleanOrDefault(
      values.include_profile_details_in_modmail,
      DEFAULT_WHOLESOME_SHIELD_SETTINGS.include_profile_details_in_modmail
    ),
    include_content_details_in_modmail: booleanOrDefault(
      values.include_content_details_in_modmail,
      DEFAULT_WHOLESOME_SHIELD_SETTINGS.include_content_details_in_modmail
    ),
    include_detection_details_in_modmail: booleanOrDefault(
      values.include_detection_details_in_modmail,
      DEFAULT_WHOLESOME_SHIELD_SETTINGS.include_detection_details_in_modmail
    ),
    scan_limit: clampScanLimit(values.scan_limit),
  };
}

function booleanOrDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function clampScanLimit(value: unknown): number {
  const numericValue =
    typeof value === 'number' && Number.isFinite(value)
      ? Math.floor(value)
      : DEFAULT_WHOLESOME_SHIELD_SETTINGS.scan_limit;
  return Math.max(1, Math.min(numericValue, 100));
}

function clampNumberSetting(value: unknown, fallback: number): number {
  const numericValue = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.max(1, Math.min(numericValue, 100));
}

function stringOrDefault(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function modmailNotificationLevelOrDefault(value: unknown): ModmailNotificationLevel {
  if (value === 'off' || value === 'bans_only' || value === 'all_violations') {
    return value;
  }

  return DEFAULT_WHOLESOME_SHIELD_SETTINGS.modmail_notifications;
}
