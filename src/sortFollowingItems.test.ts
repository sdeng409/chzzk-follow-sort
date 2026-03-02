import { describe, expect, it } from 'vitest';

import { SORT_MODES, type SortModeId } from './sortModes';
import { sortFollowingItems, type SortableFollowingItem } from './sortFollowingItems';

interface TestItem extends SortableFollowingItem {
  id: string;
}

function getIds(items: readonly TestItem[]): string[] {
  return items.map((item) => item.id);
}

const API_SORT_MODES: readonly SortModeId[] = [
  SORT_MODES.RECOMMEND,
  SORT_MODES.POPULAR,
  SORT_MODES.UNPOPULAR,
  SORT_MODES.LATEST,
  SORT_MODES.OLDEST,
];

describe('sortFollowingItems', () => {
  for (const mode of API_SORT_MODES) {
    it(`sorts by API rank for ${mode}`, () => {
      const input: TestItem[] = [
        { id: 'rank-2', key: 'rank-2', apiSortRank: 2 },
        { id: 'rank-0', key: 'rank-0', apiSortRank: 0 },
        { id: 'rank-1', key: 'rank-1', apiSortRank: 1 },
      ];

      const output = sortFollowingItems(input, mode);

      expect(getIds(output)).toEqual(['rank-0', 'rank-1', 'rank-2']);
    });
  }

  it('keeps unranked items after ranked items in original order', () => {
    const input: TestItem[] = [
      { id: 'none-1', key: 'none-1' },
      { id: 'rank-1', key: 'rank-1', apiSortRank: 1 },
      { id: 'none-2', key: 'none-2' },
      { id: 'rank-3', key: 'rank-3', apiSortRank: 3 },
      { id: 'none-3', key: 'none-3' },
    ];

    const output = sortFollowingItems(input, SORT_MODES.RECOMMEND);

    expect(getIds(output)).toEqual(['rank-1', 'rank-3', 'none-1', 'none-2', 'none-3']);
  });

  it('keeps original order when all sort keys tie', () => {
    const input: TestItem[] = [
      { id: 'first', key: 'first', apiSortRank: 1 },
      { id: 'second', key: 'second', apiSortRank: 1 },
      { id: 'third', key: 'third', apiSortRank: 1 },
    ];

    for (const mode of API_SORT_MODES) {
      const output = sortFollowingItems(input, mode);
      expect(getIds(output)).toEqual(['first', 'second', 'third']);
    }
  });

  it('does not mutate input array', () => {
    const input: TestItem[] = [
      { id: 'b', key: 'b', apiSortRank: 1 },
      { id: 'a', key: 'a', apiSortRank: 0 },
    ];

    const output = sortFollowingItems(input, SORT_MODES.POPULAR);

    expect(getIds(output)).toEqual(['a', 'b']);
    expect(getIds(input)).toEqual(['b', 'a']);
  });
});
