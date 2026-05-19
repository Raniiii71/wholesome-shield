import { isWholesomeShieldNotice } from './messages';
import type { ModerationItem } from './types';

type LooseRecord = Record<string, unknown>;

export function postFromPayload(payload: LooseRecord): ModerationItem | undefined {
  const post = objectValue(payload.post);
  const author = objectValue(payload.author);
  const subreddit = objectValue(payload.subreddit);

  return {
    kind: 'post',
    id: stringValue(post.id) ?? '',
    subredditName: stringValue(post.subredditName) ?? stringValue(subreddit.name),
    authorId: stringValue(author.id) ?? stringValue(post.authorId),
    authorName: usernameFromPayload(author) ?? stringValue(post.authorName),
    title: stringValue(post.title),
    body: stringValue(post.body) ?? stringValue(post.selftext),
    url: stringValue(post.url),
    flairText: flairText(post),
    nsfw: booleanValue(post.nsfw) ?? booleanValue(post.over18),
    permalink: stringValue(post.permalink),
    mediaUrls: mediaUrls(post),
    reportCount: reportCount(post),
    reportReasons: reportReasons(post, payload),
  };
}

export function commentFromPayload(payload: LooseRecord): ModerationItem | undefined {
  const comment = objectValue(payload.comment);
  const author = objectValue(payload.author);
  const subreddit = objectValue(payload.subreddit);
  const body = stringValue(comment.body) ?? '';

  if (isWholesomeShieldNotice(body)) return undefined;

  return {
    kind: 'comment',
    id: stringValue(comment.id) ?? '',
    subredditName: stringValue(comment.subredditName) ?? stringValue(subreddit.name),
    authorId: stringValue(author.id) ?? stringValue(comment.authorId),
    authorName: usernameFromPayload(author) ?? stringValue(comment.authorName) ?? stringValue(comment.author),
    body,
    permalink: stringValue(comment.permalink),
    reportCount: reportCount(comment),
    reportReasons: reportReasons(comment, payload),
    mediaUrls: stringArray(comment.mediaUrls),
  };
}

export function isValidModerationItem(item: ModerationItem | undefined): item is ModerationItem {
  return Boolean(item?.id && item.authorName && item.authorName !== '[deleted]');
}

function flairText(post: LooseRecord): string | undefined {
  const flair = objectValue(post.flair);
  return stringValue(post.flairText) ?? stringValue(flair.text) ?? stringValue(post.linkFlairText);
}

function mediaUrls(post: LooseRecord): string[] {
  const urls = new Set<string>();
  for (const key of ['url', 'thumbnail', 'mediaUrl']) {
    const value = stringValue(post[key]);
    if (value) urls.add(value);
  }

  const secureMedia = objectValue(post.secureMedia);
  const redditVideo = objectValue(secureMedia.reddit_video) ?? objectValue(secureMedia.redditVideo);
  const fallbackUrl = stringValue(redditVideo.fallback_url) ?? stringValue(redditVideo.fallbackUrl);
  if (fallbackUrl) urls.add(fallbackUrl);

  for (const value of [...stringArray(post.mediaUrls), ...stringArray(post.galleryImages)]) {
    urls.add(value);
  }

  return [...urls];
}

function usernameFromPayload(author: LooseRecord): string | undefined {
  return stringValue(author.username) ?? stringValue(author.name);
}

function objectValue(value: unknown): LooseRecord {
  return typeof value === 'object' && value !== null ? (value as LooseRecord) : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function reportCount(post: LooseRecord): number | undefined {
  return numberValue(post.numberOfReports) ?? numberValue(post.numReports) ?? numberValue(post.reportCount);
}

function reportReasons(thing: LooseRecord, payload: LooseRecord): string[] | undefined {
  const reasons = [
    ...stringArray(thing.userReportReasons),
    ...stringArray(thing.modReportReasons),
    ...stringArray(thing.userReports),
    ...stringArray(thing.modReports),
  ];
  const triggerReason = stringValue(payload.reason);
  if (triggerReason) reasons.push(triggerReason);

  return reasons.length > 0 ? reasons : undefined;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (typeof item === 'string') return [item];
    if (Array.isArray(item)) return item.filter((nested): nested is string => typeof nested === 'string');
    return [];
  });
}
