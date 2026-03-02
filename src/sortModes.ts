export const SORT_MODES = {
  RECOMMEND: 'RECOMMEND',
  POPULAR: 'POPULAR',
  UNPOPULAR: 'UNPOPULAR',
  LATEST: 'LATEST',
  OLDEST: 'OLDEST',
} as const;

export type SortModeId = (typeof SORT_MODES)[keyof typeof SORT_MODES];
