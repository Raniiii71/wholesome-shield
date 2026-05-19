import { banMessage, privateWarningMessage, publicWarningComment } from './messages';
import { scanMedia } from './media';
import { detectRuleViolations } from './rules';
import type { DetectionResult, ModerationDecision, ModerationItem, ViolationAction, ViolationState } from './types';

export type ModerationRuntime = {
  getViolationState(item: ModerationItem): Promise<ViolationState>;
  saveViolationState(item: ModerationItem, state: ViolationState): Promise<void>;
  remove(item: ModerationItem, isSpam: boolean): Promise<void>;
  reply(item: ModerationItem, text: string): Promise<void>;
  message(item: ModerationItem, subject: string, text: string): Promise<void>;
  ban(item: ModerationItem, text: string): Promise<void>;
};

export async function moderateItem(item: ModerationItem, runtime: ModerationRuntime): Promise<ModerationDecision> {
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

  await runtime.remove(item, detection.isSpam);
  await runtime.reply(item, publicWarningComment(item, detection.reasons, nextCount));
  await runtime.message(
    item,
    nextCount >= 2 ? 'Final warning from WholesomeShield' : 'Warning from WholesomeShield',
    privateWarningMessage(item, detection.reasons, nextCount)
  );
  await runtime.saveViolationState(item, {
    count: nextCount,
    updatedAt: new Date().toISOString(),
    lastContentId: item.id,
  });

  if (action === 'ban') {
    await runtime.ban(item, banMessage(item, detection.reasons));
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
