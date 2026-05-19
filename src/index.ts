import { redis } from '@devvit/redis';
import type { Comment, Post } from '@devvit/reddit';
import { createServer, getServerPort, reddit, scheduler } from '@devvit/web/server';
import type { TriggerResponse } from '@devvit/web/shared';
import type { MenuItemRequest, UiResponse } from '@devvit/shared';
import { serve } from '@hono/node-server';
import { Hono, type Context } from 'hono';

import { formatReasons } from './server/messages';
import { moderateItem, type ModerationOptions, type ModerationRuntime } from './server/moderation';
import { commentFromPayload, isValidModerationItem, postFromPayload } from './server/payload';
import { getWholesomeShieldSettings } from './server/settings';
import type { ModerationItem, ViolationState } from './server/types';

const app = new Hono();
const DEFAULT_SCAN_LIMIT = 50;
const SUBREDDIT_SCAN_CRON = '* * * * *';
const SCAN_MEMORY_TTL_SECONDS = 7 * 24 * 60 * 60;

type ScheduledScanPayload = {
  data?: {
    subredditName?: string;
    limit?: number;
  };
  subredditName?: string;
  limit?: number;
};

type ScanResult = {
  subredditName: string;
  checked: number;
  removed: number;
  allowed: number;
  skipped: number;
  errors: number;
};

app.post('/internal/menu/shield-check', async (c) => {
  const payload = await c.req.json<MenuItemRequest>();
  const item = await itemFromMenuRequest(payload);

  if (!item) {
    console.log(`WholesomeShield menu ignored: unsupported target ${payload.targetId}`);
    return c.json<UiResponse>({ showToast: 'WholesomeShield could not inspect this item.' }, 200);
  }

  const moderationSettings = await getWholesomeShieldSettings();
  const decision = await moderateItem(item, redditRuntime, moderationOptionsFromSettings(moderationSettings));
  console.log(
    `WholesomeShield menu: ${decision.shouldRemove ? 'removed' : 'allowed'} ${item.kind} ${item.id} by u/${
      item.authorName
    } score=${decision.score} reasons=${decision.reasons.map((reason) => reason.category).join(',') || 'none'}`
  );

  return c.json<UiResponse>(
    {
      showToast: decision.shouldRemove
        ? 'WholesomeShield removed this content.'
        : 'WholesomeShield did not find a removable violation.',
    },
    200
  );
});

app.post('/internal/triggers/app-install', async (c) => {
  const payload = await c.req.json<Record<string, unknown>>();
  const subredditName = subredditNameFromTrigger(payload);
  if (subredditName) {
    await ensureSubredditScanner(subredditName);
  }

  console.log(`WholesomeShield installed: ${JSON.stringify(payload)}`);
  return c.json<TriggerResponse>({}, 200);
});

app.post('/internal/triggers/app-upgrade', async (c) => {
  const payload = await c.req.json<Record<string, unknown>>();
  const subredditName = subredditNameFromTrigger(payload);
  if (subredditName) {
    await ensureSubredditScanner(subredditName);
  }

  console.log(`WholesomeShield upgraded: ${JSON.stringify(payload)}`);
  return c.json<TriggerResponse>({}, 200);
});

app.post('/internal/triggers/post-submit', async (c) => {
  const payload = await c.req.json<Record<string, unknown>>();
  const item = postFromPayload(payload);
  return handleModeration('post-submit', item, c);
});

app.post('/internal/triggers/post-create', async (c) => {
  const payload = await c.req.json<Record<string, unknown>>();
  const item = postFromPayload(payload);
  return handleModeration('post-create', item, c);
});

app.post('/internal/triggers/comment-submit', async (c) => {
  const payload = await c.req.json<Record<string, unknown>>();
  const item = commentFromPayload(payload);
  return handleModeration('comment-submit', item, c);
});

app.post('/internal/triggers/comment-create', async (c) => {
  const payload = await c.req.json<Record<string, unknown>>();
  const item = commentFromPayload(payload);
  return handleModeration('comment-create', item, c);
});

app.post('/internal/triggers/post-nsfw-update', async (c) => {
  const payload = await c.req.json<Record<string, unknown>>();
  const item = postFromPayload(payload);
  return handleModeration('post-nsfw-update', item, c);
});

app.post('/internal/triggers/post-flair-update', async (c) => {
  const payload = await c.req.json<Record<string, unknown>>();
  const item = postFromPayload(payload);
  return handleModeration('post-flair-update', item, c);
});

app.post('/internal/cron/scan-subreddit', async (c) => {
  const payload = await readScanPayload(c);
  const subredditName = payload.data?.subredditName ?? payload.subredditName;
  if (!subredditName) {
    console.log(`WholesomeShield automatic scan ignored: missing subredditName`);
    return c.json({ status: 'ignored' }, 200);
  }

  const moderationSettings = await getWholesomeShieldSettings();
  if (!moderationSettings.automatic_moderation) {
    console.log(`WholesomeShield automatic scan skipped for r/${subredditName}: automatic moderation is off`);
    return c.json({ status: 'disabled', subredditName }, 200);
  }

  const limit = moderationSettings.scan_limit;
  const result = await scanSubreddit(subredditName, limit);

  console.log(
    `WholesomeShield automatic scan: r/${result.subredditName} checked=${result.checked} removed=${result.removed} allowed=${result.allowed} skipped=${result.skipped} errors=${result.errors}`
  );

  return c.json({ status: 'ok', ...result }, 200);
});

async function handleModeration(triggerName: string, item: ModerationItem | undefined, c: Context) {
  if (!isValidModerationItem(item)) {
    console.log(`WholesomeShield ignored ${triggerName}: invalid item`);
    return c.json<TriggerResponse>({ status: 'ignored' }, 200);
  }

  if (item.authorName?.toLowerCase() === 'wholesome-shield') {
    console.log(`WholesomeShield ignored ${triggerName}: own app content ${item.id}`);
    return c.json<TriggerResponse>({ status: 'ignored' }, 200);
  }

  const moderationSettings = await getWholesomeShieldSettings();
  if (!moderationSettings.automatic_moderation) {
    console.log(`WholesomeShield skipped ${triggerName}: automatic moderation is off for ${item.id}`);
    return c.json<TriggerResponse>({ status: 'ignored' }, 200);
  }

  const decision = await moderateItem(item, redditRuntime, moderationOptionsFromSettings(moderationSettings));
  console.log(
    `WholesomeShield ${triggerName}: ${decision.shouldRemove ? 'removed' : 'allowed'} ${item.kind} ${item.id} by u/${
      item.authorName
    } score=${decision.score} reasons=${decision.reasons.map((reason) => reason.category).join(',') || 'none'}`
  );
  return c.json<TriggerResponse>(
    {
      status: decision.shouldRemove ? 'ok' : 'ignored',
    },
    200
  );
}

async function ensureSubredditScanner(subredditName: string): Promise<void> {
  const existingJobId = await redis.get(scannerJobKey(subredditName));
  if (existingJobId) {
    try {
      await scheduler.cancelJob(existingJobId);
    } catch (error) {
      console.error(`WholesomeShield could not cancel old scanner job for r/${subredditName}; replacing it.`, error);
    }
  }

  const jobId = await scheduler.runJob({
    name: 'scan-subreddit',
    cron: SUBREDDIT_SCAN_CRON,
    data: {
      subredditName,
      limit: DEFAULT_SCAN_LIMIT,
    },
  });

  await redis.set(scannerJobKey(subredditName), jobId);
  console.log(`WholesomeShield scheduled automatic scans for r/${subredditName} with job ${jobId}`);
}

async function scanSubreddit(subredditName: string, requestedLimit: number): Promise<ScanResult> {
  const limit = Math.max(1, Math.min(requestedLimit, 100));
  const result: ScanResult = {
    subredditName,
    checked: 0,
    removed: 0,
    allowed: 0,
    skipped: 0,
    errors: 0,
  };
  const candidates = await getScanCandidates(subredditName, limit);

  for (const candidate of candidates) {
    if (candidate.removed || candidate.spam) {
      result.skipped += 1;
      continue;
    }

    const item = itemFromCandidate(candidate);
    if (!item || item.authorName?.toLowerCase() === 'wholesome-shield') {
      result.skipped += 1;
      continue;
    }

    const memoryKey = scanMemoryKey(subredditName, item);
    const fingerprint = scanFingerprint(item);
    const previousFingerprint = await redis.get(memoryKey);
    if (previousFingerprint === fingerprint) {
      result.skipped += 1;
      continue;
    }

    try {
      const moderationSettings = await getWholesomeShieldSettings();
      const decision = await moderateItem(item, redditRuntime, moderationOptionsFromSettings(moderationSettings));
      await rememberScan(memoryKey, fingerprint);
      result.checked += 1;

      if (decision.shouldRemove) {
        result.removed += 1;
      } else {
        result.allowed += 1;
      }

      console.log(
        `WholesomeShield auto-scan: ${decision.shouldRemove ? 'removed' : 'allowed'} ${item.kind} ${item.id} by u/${
          item.authorName
        } score=${decision.score} reasons=${decision.reasons.map((reason) => reason.category).join(',') || 'none'}`
      );
    } catch (error) {
      result.errors += 1;
      console.error(`WholesomeShield auto-scan failed for ${item.kind} ${item.id}:`, error);
    }
  }

  return result;
}

async function getScanCandidates(subredditName: string, limit: number): Promise<Array<Post | Comment>> {
  const seen = new Set<string>();
  const candidates: Array<Post | Comment> = [];

  const unmoderatedItems = await reddit.getUnmoderated({ subreddit: subredditName, type: 'all', limit }).get(limit);
  for (const item of unmoderatedItems) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      candidates.push(item);
    }
  }

  const newPostsLimit = Math.min(limit, 25);
  const newPosts = await reddit
    .getNewPosts({ subredditName, limit: newPostsLimit, pageSize: newPostsLimit })
    .get(newPostsLimit);
  for (const post of newPosts) {
    if (!seen.has(post.id)) {
      seen.add(post.id);
      candidates.push(post);
    }
  }

  return candidates.slice(0, limit);
}

function itemFromCandidate(candidate: Post | Comment): ModerationItem | undefined {
  if (candidate.id.startsWith('t3_')) {
    return itemFromPost(candidate as Post);
  }

  if (candidate.id.startsWith('t1_')) {
    return itemFromComment(candidate as Comment);
  }

  return undefined;
}

function itemFromPost(post: Post): ModerationItem {
  return {
    kind: 'post',
    id: post.id,
    subredditName: post.subredditName,
    authorId: post.authorId,
    authorName: post.authorName,
    title: post.title,
    body: post.body,
    url: post.url,
    flairText: post.flair?.text,
    nsfw: post.nsfw,
    permalink: post.permalink,
    mediaUrls: post.gallery.map((media) => media.url),
  };
}

function itemFromComment(comment: Comment): ModerationItem {
  return {
    kind: 'comment',
    id: comment.id,
    subredditName: comment.subredditName,
    authorId: comment.authorId,
    authorName: comment.authorName,
    body: comment.body,
    permalink: comment.permalink,
    mediaUrls: [],
  };
}

const redditRuntime: ModerationRuntime = {
  async getViolationState(item) {
    const raw = await redis.get(violationKey(item));
    if (!raw) return emptyViolationState();

    try {
      return {
        ...emptyViolationState(),
        ...(JSON.parse(raw) as Partial<ViolationState>),
      };
    } catch {
      return emptyViolationState();
    }
  },

  async saveViolationState(item, state) {
    await redis.set(violationKey(item), JSON.stringify(state));
  },

  async remove(item, isSpam) {
    await reddit.remove(thingId(item), isSpam);
  },

  async reply(item, text) {
    await reddit.submitComment({
      id: thingId(item),
      text,
      runAs: 'APP',
    });
  },

  async message(item, subject, text) {
    if (!item.authorName) return;

    await reddit.sendPrivateMessage({
      to: item.authorName,
      subject,
      text,
    });
  },

  async ban(item, text) {
    if (!item.authorName || !item.subredditName) return;

    try {
      await reddit.banUser({
        username: item.authorName,
        subredditName: item.subredditName,
        context: thingId(item),
        duration: 0,
        reason: 'WholesomeShield repeated unsafe content',
        note: 'Auto-ban after second WholesomeShield violation',
        message: text,
      });
    } catch (error) {
      console.error(`WholesomeShield could not ban u/${item.authorName}; continuing after removal/warnings.`, error);
    }
  },

  async notifyMods(item, reasons, action) {
    if (!item.subredditName) return;

    try {
      const subreddit = await reddit.getSubredditByName(item.subredditName);
      const target = item.permalink ? `[View ${item.kind}](${item.permalink})` : `${item.kind} ${item.id}`;
      await reddit.modMail.createModNotification({
        subredditId: subreddit.id,
        subject: `WholesomeShield ${action === 'ban' ? 'repeat violation' : 'violation'}: u/${
          item.authorName ?? 'unknown'
        }`,
        bodyMarkdown: [
          `WholesomeShield detected unsafe ${item.kind} content in r/${item.subredditName}.`,
          '',
          `Author: u/${item.authorName ?? 'unknown'}`,
          `Action: ${action === 'ban' ? 'final warning / ban path' : 'warning path'}`,
          `Content: ${target}`,
          '',
          'Reasons:',
          formatReasons(reasons),
        ].join('\n'),
      });
    } catch (error) {
      console.error(`WholesomeShield could not notify moderators for ${item.kind} ${item.id}; continuing.`, error);
    }
  },
};

function moderationOptionsFromSettings(settings: Awaited<ReturnType<typeof getWholesomeShieldSettings>>): ModerationOptions {
  return {
    removeContent: settings.remove_unsafe_content,
    leaveWarningComment: settings.leave_warning_comment,
    sendPrivateWarning: settings.send_private_warning,
    banRepeatViolators: settings.ban_repeat_violators,
    notifyModerators: settings.notify_moderators,
  };
}

function violationKey(item: ModerationItem): string {
  const userKey = item.authorId ?? item.authorName ?? 'unknown';
  const subredditKey = item.subredditName ?? 'unknown';
  return `violations:${subredditKey}:${userKey}`;
}

function scannerJobKey(subredditName: string): string {
  return `scanner-job:${subredditName}`;
}

function subredditNameFromTrigger(payload: Record<string, unknown>): string | undefined {
  const subreddit = payload.subreddit;
  if (!isRecord(subreddit)) return undefined;

  const name = subreddit.name;
  return typeof name === 'string' && name.length > 0 ? name : undefined;
}

function thingId(item: ModerationItem): `t1_${string}` | `t3_${string}` {
  if (item.id.startsWith('t1_') || item.id.startsWith('t3_')) {
    return item.id as `t1_${string}` | `t3_${string}`;
  }

  return `${item.kind === 'comment' ? 't1' : 't3'}_${item.id}` as `t1_${string}` | `t3_${string}`;
}

async function readScanPayload(c: Context): Promise<ScheduledScanPayload> {
  try {
    return await c.req.json<ScheduledScanPayload>();
  } catch {
    return {};
  }
}

function scanMemoryKey(subredditName: string, item: ModerationItem): string {
  return `scan:${subredditName}:${item.id}`;
}

function scanFingerprint(item: ModerationItem): string {
  return JSON.stringify({
    title: item.title ?? '',
    body: item.body ?? '',
    url: item.url ?? '',
    flairText: item.flairText ?? '',
    nsfw: item.nsfw ?? false,
    mediaUrls: item.mediaUrls ?? [],
  });
}

async function rememberScan(memoryKey: string, fingerprint: string): Promise<void> {
  await redis.set(memoryKey, fingerprint);
  await redis.expire(memoryKey, SCAN_MEMORY_TTL_SECONDS);
}

async function itemFromMenuRequest(payload: MenuItemRequest): Promise<ModerationItem | undefined> {
  if (payload.location === 'post' && payload.targetId.startsWith('t3_')) {
    const post = await reddit.getPostById(payload.targetId as `t3_${string}`);
    return {
      kind: 'post',
      id: post.id,
      subredditName: post.subredditName,
      authorId: post.authorId,
      authorName: post.authorName,
      title: post.title,
      body: post.body,
      url: post.url,
      flairText: post.flair?.text,
      nsfw: post.nsfw,
      permalink: post.permalink,
      mediaUrls: post.gallery.map((media) => media.url),
    };
  }

  if (payload.location === 'comment' && payload.targetId.startsWith('t1_')) {
    const comment = await reddit.getCommentById(payload.targetId as `t1_${string}`);
    return {
      kind: 'comment',
      id: comment.id,
      subredditName: comment.subredditName,
      authorId: comment.authorId,
      authorName: comment.authorName,
      body: comment.body,
      permalink: comment.permalink,
      mediaUrls: [],
    };
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function emptyViolationState(): ViolationState {
  return {
    count: 0,
    updatedAt: new Date(0).toISOString(),
  };
}

serve({
  fetch: app.fetch,
  createServer,
  port: getServerPort(),
});
