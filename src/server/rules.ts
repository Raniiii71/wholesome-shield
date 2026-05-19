import type { DetectionResult, ModerationItem, ViolationReason } from './types';

const REMOVE_THRESHOLD = 7;
const DEFAULT_REPORT_REMOVAL_THRESHOLD = 5;

export type RuleDetectionOptions = {
  removeReportedPosts?: boolean;
  reportRemovalThreshold?: number;
};

const ADULT_KEYWORDS = [
  'nsfw',
  '18+',
  'porn',
  'porno',
  'nude',
  'nudes',
  'xxx',
  'sex',
  'sexting',
  'escort',
  'camgirl',
  'cam boy',
  'hookup',
];

const HIGH_CONFIDENCE_ADULT_KEYWORDS = ['nsfw', '18+', 'porn', 'porno', 'xxx', 'nude', 'nudes'];

const ADULT_PROMO_KEYWORDS = [
  'onlyfans',
  'fansly',
  'premium snap',
  'paid snap',
  'leaked',
  'dropbox nudes',
  'dm for pics',
  'dm for content',
  'selling content',
  'hot video',
  'sexy video',
];

const UNSAFE_PHRASES = [
  'kill yourself',
  'kys',
  'go die',
  'rape threat',
  'i will dox',
  'doxxing',
  'send me minors',
];

const SPAM_PHRASES = [
  'free crypto',
  'guaranteed income',
  'work from home daily payout',
  'click this link',
  'limited time offer',
  'upvote for upvote',
  'join my channel',
  'dm me for deal',
];

const ADULT_DOMAINS = [
  'onlyfans.com',
  'fansly.com',
  'pornhub.com',
  'xvideos.com',
  'xnxx.com',
  'redtube.com',
  'youporn.com',
  'spankbang.com',
  'brazzers.com',
  'chaturbate.com',
  'myfreecams.com',
  'manyvids.com',
];

const TELEGRAM_DOMAINS = ['t.me', 'telegram.me', 'telegram.dog'];
const SHORTENER_DOMAINS = ['bit.ly', 'tinyurl.com', 'cutt.ly', 'is.gd', 'rebrand.ly', 'shorte.st'];
const BAD_FLAIR_TERMS = ['nsfw', '18+', 'adult', 'spicy', 'lewd', 'promo', 'advertisement'];

export function detectRuleViolations(item: ModerationItem, options: RuleDetectionOptions = {}): DetectionResult {
  const reasons: ViolationReason[] = [];
  const reportRemovalThreshold = clampReportThreshold(
    options.reportRemovalThreshold ?? DEFAULT_REPORT_REMOVAL_THRESHOLD
  );
  const fields = [item.title ?? '', item.body ?? '', item.url ?? '', item.flairText ?? '', ...(item.mediaUrls ?? [])];
  const searchableText = normalizeText(fields.join(' '));
  const username = normalizeText(item.authorName ?? '');
  const flair = normalizeText(item.flairText ?? '');
  const urls = extractUrls(fields.join(' '));
  const hosts = urls.map(getHostname).filter(Boolean);

  if (item.nsfw) {
    reasons.push({
      category: 'nsfw-flag',
      label: 'Reddit marked this post as NSFW',
      score: 9,
    });
  }

  if (
    item.kind === 'post' &&
    options.removeReportedPosts !== false &&
    typeof item.reportCount === 'number' &&
    item.reportCount >= reportRemovalThreshold
  ) {
    reasons.push({
      category: 'reports',
      label: 'Post reached moderator report threshold',
      score: 10,
      evidence: `${item.reportCount} reports`,
    });
  }

  addKeywordReasons(reasons, searchableText, ADULT_PROMO_KEYWORDS, {
    category: 'adult-promo',
    label: 'Adult promotion keyword',
    score: 8,
  });

  addKeywordReasons(reasons, searchableText, HIGH_CONFIDENCE_ADULT_KEYWORDS, {
    category: 'adult-keyword',
    label: 'High-confidence adult keyword',
    score: 8,
  });

  addKeywordReasons(reasons, searchableText, ADULT_KEYWORDS, {
    category: 'adult-keyword',
    label: 'Adult keyword',
    score: 5,
  });

  addKeywordReasons(reasons, searchableText, UNSAFE_PHRASES, {
    category: 'unsafe-language',
    label: 'Unsafe language',
    score: 7,
  });

  addKeywordReasons(reasons, searchableText, SPAM_PHRASES, {
    category: 'spam',
    label: 'Spam phrase',
    score: 5,
  });

  for (const host of hosts) {
    if (matchesDomain(host, ADULT_DOMAINS)) {
      reasons.push({
        category: 'adult-domain',
        label: 'Adult website link',
        score: 10,
        evidence: host,
      });
    }

    if (matchesDomain(host, TELEGRAM_DOMAINS)) {
      const score = /adult|nsfw|18\+|onlyfans|fansly|nude|porn/.test(searchableText) ? 9 : 6;
      reasons.push({
        category: 'telegram-spam',
        label: 'Telegram promotion link',
        score,
        evidence: host,
      });
    }

    if (matchesDomain(host, SHORTENER_DOMAINS) && searchableText.includes('dm')) {
      reasons.push({
        category: 'spam',
        label: 'Shortened promotional link',
        score: 4,
        evidence: host,
      });
    }
  }

  if (urls.length >= 4) {
    reasons.push({
      category: 'spam',
      label: 'Many links in one submission',
      score: 4,
      evidence: `${urls.length} links`,
    });
  }

  addKeywordReasons(reasons, username, [...ADULT_KEYWORDS, ...ADULT_PROMO_KEYWORDS], {
    category: 'suspicious-username',
    label: 'Suspicious adult-themed username',
    score: 4,
  });

  addKeywordReasons(reasons, flair, BAD_FLAIR_TERMS, {
    category: 'bad-flair',
    label: 'Unsafe post flair',
    score: 8,
  });

  const score = clampScore(reasons.reduce((sum, reason) => sum + reason.score, 0));
  const shouldRemove = score >= REMOVE_THRESHOLD || reasons.some((reason) => reason.score >= 9);
  const isSpam = reasons.some((reason) =>
    ['adult-domain', 'adult-promo', 'telegram-spam', 'spam'].includes(reason.category)
  );

  return {
    shouldRemove,
    isSpam,
    score,
    reasons: dedupeReasons(reasons),
  };
}

export function extractUrls(text: string): string[] {
  const matches = text.match(/\b(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<>()]*)?/gi);
  return matches?.map((url) => url.replace(/[.,!?;:]+$/, '')) ?? [];
}

function addKeywordReasons(
  reasons: ViolationReason[],
  text: string,
  keywords: string[],
  options: Omit<ViolationReason, 'evidence'>
): void {
  for (const keyword of keywords) {
    if (containsPhrase(text, keyword)) {
      reasons.push({ ...options, evidence: keyword });
    }
  }
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[_*`~|()[\]{}"'.,!?;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function containsPhrase(text: string, phrase: string): boolean {
  const normalizedPhrase = normalizeText(phrase);
  return new RegExp(`(^|\\s)${escapeRegExp(normalizedPhrase)}(\\s|$)`, 'i').test(text);
}

function getHostname(rawUrl: string): string {
  try {
    const url = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function matchesDomain(host: string, domains: string[]): boolean {
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function dedupeReasons(reasons: ViolationReason[]): ViolationReason[] {
  const seen = new Set<string>();
  return reasons.filter((reason) => {
    const key = `${reason.category}:${reason.evidence ?? reason.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function clampScore(score: number): number {
  return Math.min(score, 20);
}

function clampReportThreshold(value: number): number {
  return Math.max(1, Math.min(Math.floor(value), 100));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
