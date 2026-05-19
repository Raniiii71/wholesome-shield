import { banMessage, privateWarningMessage, publicWarningComment } from './messages';
import { scanMedia } from './media';
import { detectRuleViolations } from './rules';
import type { ModmailNotificationLevel } from './settings';
import type { DetectionResult, ModerationDecision, ModerationItem, ViolationAction, ViolationState } from './types';

export type ModeratorNotificationContext = {
  violationCount: number;
  banAttempted: boolean;
  banApplied: boolean;
};

export type ModerationRuntime = {
  getViolationState(item: ModerationItem): Promise<ViolationState>;
  saveViolationState(item: ModerationItem, state: ViolationState): Promise<void>;
  remove(item: ModerationItem, isSpam: boolean): Promise<void>;
  reply(item: ModerationItem, text: string): Promise<void>;
  message(item: ModerationItem, subject: string, text: string): Promise<void>;
  ban(item: ModerationItem, text: string): Promise<boolean>;
  notifyMods?(
    item: ModerationItem,
    detection: DetectionResult,
    action: ViolationAction,
    context: ModeratorNotificationContext
  ): Promise<void>;
};

export type ModerationOptions = {
  removeContent: boolean;
  leaveWarningComment: boolean;
  sendPrivateWarning: boolean;
  banRepeatViolators: boolean;
  modmailNotifications: ModmailNotificationLevel;
};

export const DEFAULT_MODERATION_OPTIONS: ModerationOptions = {
  removeContent: true,
  leaveWarningComment: true,
  sendPrivateWarning: true,
  banRepeatViolators: true,
  modmailNotifications: 'bans_only',
};

export async function moderateItem(
  item: ModerationItem,
  runtime: ModerationRuntime,
  options: ModerationOptions = DEFAULT_MODERATION_OPTIONS
): Promise<ModerationDecision> {
  const detection = await evaluateItem(item);

  if (!detection.shouldRemove) {
    return {
      ...detection,
      action: 'warn',
    };
  }

  const previousState = await runtime.getViolationState(item);
  if (previousState.lastContentId === item.id) {
    return {
      ...detection,
      action: actionForCount(previousState.count),
    };
  }

  const nextCount = previousState.count + 1;
  const action: ViolationAction = nextCount >= 2 ? 'ban' : 'warn';

  if (options.removeContent) {
    await runtime.remove(item, detection.isSpam);
  }

  if (options.leaveWarningComment) {
    await runtime.reply(item, publicWarningComment(item, detection.reasons, nextCount));
  }

  if (options.sendPrivateWarning) {
    await runtime.message(
      item,
      nextCount >= 2 ? 'Final warning from WholesomeShield' : 'Warning from WholesomeShield',
      privateWarningMessage(item, detection.reasons, nextCount)
    );
  }

  await runtime.saveViolationState(item, {
    count: nextCount,
    updatedAt: new Date().toISOString(),
    lastContentId: item.id,
  });

  let banApplied = false;
  const banAttempted = action === 'ban' && options.banRepeatViolators;
  if (action === 'ban' && options.banRepeatViolators) {
    banApplied = await runtime.ban(item, banMessage(item, detection.reasons));
  }

  if (shouldNotifyModerators(options.modmailNotifications, action, banAttempted) && runtime.notifyMods) {
    await runtime.notifyMods(item, detection, action, {
      violationCount: nextCount,
      banAttempted,
      banApplied,
    });
  }

  return {
    ...detection,
    action,
  };
}

export async function evaluateItem(item: ModerationItem): Promise<DetectionResult> {
  const textDetection = detectRuleViolations(item);
  const mediaDetection = await scanMedia(item);
  return combineDetections(textDetection, mediaDetection);
}

function combineDetections(...detections: DetectionResult[]): DetectionResult {
  const reasons = detections.flatMap((detection) => detection.reasons);
  const score = Math.min(
    20,
    detections.reduce((sum, detection) => sum + detection.score, 0)
  );

  return {
    shouldRemove: detections.some((detection) => detection.shouldRemove) || score >= 7,
    isSpam: detections.some((detection) => detection.isSpam),
    score,
    reasons,
  };
}

function actionForCount(count: number): ViolationAction {
  return count >= 2 ? 'ban' : 'warn';
}

function shouldNotifyModerators(
  level: ModmailNotificationLevel,
  action: ViolationAction,
  banAttempted: boolean
): boolean {
  if (level === 'all_violations') {
    return true;
  }

  return level === 'bans_only' && action === 'ban' && banAttempted;
}
