import type { DetectionResult, ModerationItem, ViolationReason } from './types';

const SUSPICIOUS_MEDIA_HOSTS = ['redgifs.com', 'erome.com', 'imgsrc.ru'];

export async function scanMedia(item: ModerationItem): Promise<DetectionResult> {
  const reasons: ViolationReason[] = [];

  for (const rawUrl of item.mediaUrls ?? []) {
    const host = getHostname(rawUrl);
    if (SUSPICIOUS_MEDIA_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
      reasons.push({
        category: 'media',
        label: 'Suspicious media host',
        score: 7,
        evidence: host,
      });
    }
  }

  const score = Math.min(
    20,
    reasons.reduce((sum, reason) => sum + reason.score, 0)
  );
  return {
    shouldRemove: score >= 7,
    isSpam: false,
    score,
    reasons,
  };
}

function getHostname(rawUrl: string): string {
  try {
    const url = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}
