import { describe, expect, it } from 'vitest';

import { cleanPostThankYouComment } from '../src/server/messages';
import { moderateItem } from '../src/server/moderation';
import { detectRuleViolations } from '../src/server/rules';
import type { ModerationItem, ViolationState } from '../src/server/types';

describe('WholesomeShield rules', () => {
  it('passes clean wholesome posts', () => {
    const result = detectRuleViolations({
      kind: 'post',
      id: 't3_clean',
      authorName: 'friendly_user',
      title: 'My cat learned a cute trick',
      body: 'Hope everyone has a lovely day.',
    });

    expect(result.shouldRemove).toBe(false);
    expect(result.score).toBe(0);
  });

  it('removes adult promotional links', () => {
    const result = detectRuleViolations({
      kind: 'post',
      id: 't3_bad',
      authorName: 'promo_user',
      title: 'Follow my page',
      body: 'New content on onlyfans.com/example',
      url: 'https://onlyfans.com/example',
    });

    expect(result.shouldRemove).toBe(true);
    expect(result.isSpam).toBe(true);
    expect(result.reasons.map((reason) => reason.category)).toContain('adult-domain');
  });

  it('removes explicit adult titles even without a link', () => {
    const result = detectRuleViolations({
      kind: 'post',
      id: 't3_explicit',
      authorName: 'test_user',
      title: 'Title: porn video Body: sexy girls hot video available',
    });

    expect(result.shouldRemove).toBe(true);
    expect(result.reasons.map((reason) => reason.category)).toContain('adult-keyword');
  });

  it('does not remove from a suspicious username alone', () => {
    const result = detectRuleViolations({
      kind: 'comment',
      id: 't1_username',
      authorName: 'nsfw_throwaway',
      body: 'This story made me smile.',
    });

    expect(result.shouldRemove).toBe(false);
    expect(result.score).toBeLessThan(7);
  });

  it('removes Telegram spam when paired with adult language', () => {
    const result = detectRuleViolations({
      kind: 'comment',
      id: 't1_telegram',
      authorName: 'random_user',
      body: 'Join my channel for nsfw drops https://t.me/example',
    });

    expect(result.shouldRemove).toBe(true);
    expect(result.reasons.map((reason) => reason.category)).toContain('telegram-spam');
  });

  it('removes posts that reach the report threshold', () => {
    const result = detectRuleViolations(
      {
        kind: 'post',
        id: 't3_reported',
        authorName: 'reported_user',
        title: 'Normal looking title',
        reportCount: 5,
      },
      {
        removeReportedPosts: true,
        reportRemovalThreshold: 5,
      }
    );

    expect(result.shouldRemove).toBe(true);
    expect(result.reasons.map((reason) => reason.category)).toContain('reports');
  });
});

describe('moderation workflow', () => {
  it('formats the clean post thank-you comment with the author username', () => {
    const text = cleanPostThankYouComment({
      kind: 'post',
      id: 't3_clean',
      authorName: 'friendly_user',
    });

    expect(text).toContain('Thank you u/friendly_user for posting on this subreddit!');
    expect(text).toContain('I am a bot, and this action was performed automatically.');
  });

  it('formats custom clean post thank-you templates', () => {
    const text = cleanPostThankYouComment(
      {
        kind: 'post',
        id: 't3_clean_custom',
        authorName: 'friendly_user',
        subredditName: 'wholesome',
      },
      'Thanks {username} for posting in {subreddit}.'
    );

    expect(text).toBe('Thanks u/friendly_user for posting in r/wholesome.');
  });

  it('warns first and bans on the second violation', async () => {
    const item: ModerationItem = {
      kind: 'comment',
      id: 't1_repeat',
      subredditName: 'wholesome',
      authorId: 't2_user',
      authorName: 'bad_actor',
      body: 'Follow my onlyfans.com/bad',
    };

    let count = 0;
    let lastContentId: string | undefined;
    const actions: string[] = [];
    const runtime = {
      getViolationState: async (): Promise<ViolationState> => ({
        count,
        updatedAt: new Date(0).toISOString(),
        ...(lastContentId ? { lastContentId } : {}),
      }),
      saveViolationState: async (_item: ModerationItem, state: ViolationState) => {
        count = state.count;
        lastContentId = state.lastContentId;
      },
      remove: async () => {
        actions.push('remove');
      },
      reply: async () => {
        actions.push('reply');
      },
      message: async () => {
        actions.push('message');
      },
      ban: async () => {
        actions.push('ban');
        return true;
      },
    };

    const first = await moderateItem(item, runtime);
    const second = await moderateItem({ ...item, id: 't1_repeat_again' }, runtime);

    expect(first.action).toBe('warn');
    expect(second.action).toBe('ban');
    expect(actions).toEqual(['remove', 'reply', 'message', 'remove', 'reply', 'message', 'ban']);
  });

  it('does not count duplicate triggers for the same content twice', async () => {
    const item: ModerationItem = {
      kind: 'post',
      id: 't3_duplicate',
      subredditName: 'wholesome',
      authorId: 't2_user',
      authorName: 'bad_actor',
      title: 'Follow my onlyfans.com/bad',
    };

    let state: ViolationState = {
      count: 0,
      updatedAt: new Date(0).toISOString(),
    };
    const actions: string[] = [];
    const runtime = {
      getViolationState: async () => state,
      saveViolationState: async (_item: ModerationItem, nextState: ViolationState) => {
        state = nextState;
      },
      remove: async () => {
        actions.push('remove');
      },
      reply: async () => {
        actions.push('reply');
      },
      message: async () => {
        actions.push('message');
      },
      ban: async () => {
        actions.push('ban');
        return true;
      },
    };

    await moderateItem(item, runtime);
    await moderateItem(item, runtime);

    expect(state.count).toBe(1);
    expect(actions).toEqual(['remove', 'reply', 'message']);
  });

  it('respects moderator action settings', async () => {
    const item: ModerationItem = {
      kind: 'post',
      id: 't3_settings',
      subredditName: 'wholesome',
      authorId: 't2_user',
      authorName: 'bad_actor',
      title: 'Follow my onlyfans.com/bad',
    };

    let state: ViolationState = {
      count: 0,
      updatedAt: new Date(0).toISOString(),
    };
    const actions: string[] = [];
    const runtime = {
      getViolationState: async () => state,
      saveViolationState: async (_item: ModerationItem, nextState: ViolationState) => {
        state = nextState;
      },
      remove: async () => {
        actions.push('remove');
      },
      reply: async () => {
        actions.push('reply');
      },
      message: async () => {
        actions.push('message');
      },
      ban: async () => {
        actions.push('ban');
        return true;
      },
      notifyMods: async () => {
        actions.push('notifyMods');
      },
    };

    await moderateItem(item, runtime, {
      removeContent: false,
      leaveWarningComment: true,
      sendPrivateWarning: false,
      banRepeatViolators: false,
      modmailNotifications: 'all_violations',
    });

    expect(state.count).toBe(1);
    expect(actions).toEqual(['reply', 'notifyMods']);
  });
});
