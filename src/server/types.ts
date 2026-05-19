export type ContentKind = 'post' | 'comment';

export type ViolationAction = 'warn' | 'ban';

export type ViolationCategory =
  | 'adult-keyword'
  | 'adult-domain'
  | 'adult-promo'
  | 'telegram-spam'
  | 'unsafe-language'
  | 'spam'
  | 'suspicious-username'
  | 'bad-flair'
  | 'nsfw-flag'
  | 'media';

export type ModerationItem = {
  kind: ContentKind;
  id: string;
  subredditName?: string | undefined;
  authorId?: string | undefined;
  authorName?: string | undefined;
  title?: string | undefined;
  body?: string | undefined;
  url?: string | undefined;
  flairText?: string | undefined;
  nsfw?: boolean | undefined;
  permalink?: string | undefined;
  mediaUrls?: string[] | undefined;
};

export type ViolationReason = {
  category: ViolationCategory;
  label: string;
  score: number;
  evidence?: string | undefined;
};

export type DetectionResult = {
  shouldRemove: boolean;
  isSpam: boolean;
  score: number;
  reasons: ViolationReason[];
};

export type ViolationState = {
  count: number;
  updatedAt: string;
  lastContentId?: string | undefined;
};

export type ModerationDecision = DetectionResult & {
  action: ViolationAction;
};
