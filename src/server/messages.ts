import type { ModerationItem, ViolationReason } from './types';

const NOTICE_HEADER = 'WholesomeShield moderation notice';

export const DEFAULT_CLEAN_POST_THANK_YOU_TEMPLATE = [
  'Thank you {username} for posting on this subreddit! Hope it follows our Rules and Guidelines.',
  '',
  "Thank you for being amazing, y'all and hope everyone has a great day <3",
  '',
  'I am a bot, and this action was performed automatically. Please contact the moderators of this subreddit if you have any questions or concerns.',
].join('\n');

export function publicWarningComment(item: ModerationItem, reasons: ViolationReason[], count: number): string {
  const reasonText = formatReasons(reasons);
  const nextStep =
    count <= 1
      ? 'This is a warning. A repeated violation may lead to a subreddit ban.'
      : 'This is a final warning and the account may be banned from this subreddit.';

  return [
    `**${NOTICE_HEADER}**`,
    '',
    `Your ${item.kind} was removed because it matched this community's family-friendly safety rules.`,
    '',
    `Reason: ${reasonText}`,
    '',
    nextStep,
    '',
    'If this was a mistake, please contact the moderators.',
  ].join('\n');
}

export function privateWarningMessage(item: ModerationItem, reasons: ViolationReason[], count: number): string {
  const reasonText = formatReasons(reasons);
  const actionText =
    count <= 1
      ? 'This is your first warning. Please avoid NSFW, adult promotion, unsafe links, spam, or harmful comments in this community.'
      : 'This is your second violation. Your content was removed again and the moderators may ban this account from the subreddit.';

  return [
    `Hi u/${item.authorName ?? 'there'},`,
    '',
    `WholesomeShield removed your ${item.kind} from r/${item.subredditName ?? 'this community'}.`,
    '',
    `Reason: ${reasonText}`,
    '',
    actionText,
    '',
    'If you believe this was wrong, reply to the moderators and include the removed content link.',
  ].join('\n');
}

export function banMessage(item: ModerationItem, reasons: ViolationReason[]): string {
  return [
    `WholesomeShield recorded a repeated safety violation in r/${item.subredditName ?? 'this community'}.`,
    '',
    `Reason: ${formatReasons(reasons)}`,
    '',
    'If you believe this was a mistake, you can appeal through modmail.',
  ].join('\n');
}

export function cleanPostThankYouComment(
  item: ModerationItem,
  template = DEFAULT_CLEAN_POST_THANK_YOU_TEMPLATE
): string {
  const username = item.authorName ? `u/${item.authorName}` : 'there';
  const subreddit = item.subredditName ? `r/${item.subredditName}` : 'this subreddit';

  return template
    .replace(/\{username\}/g, username)
    .replace(/\{author\}/g, username)
    .replace(/\{subreddit\}/g, subreddit);
}

export function formatReasons(reasons: ViolationReason[]): string {
  const labels = reasons.slice(0, 3).map((reason) => {
    return reason.evidence ? `${reason.label} (${reason.evidence})` : reason.label;
  });

  return labels.length > 0 ? labels.join(', ') : 'unsafe content signal';
}

export function isWholesomeShieldNotice(text?: string): boolean {
  return (text ?? '').includes(NOTICE_HEADER);
}
