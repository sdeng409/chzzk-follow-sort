import { SORT_MODES, type SortModeId } from './sortModes';

export interface SortableFollowingItem {
  name: string;
  apiSortRank?: number;
}

interface IndexedItem<T> {
  index: number;
  item: T;
}

type Comparator<T> = (left: IndexedItem<T>, right: IndexedItem<T>) => number;

function compareOptionalNumberAsc(
  leftValue: number | undefined,
  rightValue: number | undefined,
): number {
  if (leftValue === rightValue) {
    return 0;
  }

  if (leftValue === undefined) {
    return 1;
  }

  if (rightValue === undefined) {
    return -1;
  }

  if (leftValue < rightValue) {
    return -1;
  }

  if (leftValue > rightValue) {
    return 1;
  }

  return 0;
}

function compareApiSortRankAsc<T extends SortableFollowingItem>(
  left: IndexedItem<T>,
  right: IndexedItem<T>,
): number {
  return compareOptionalNumberAsc(left.item.apiSortRank, right.item.apiSortRank);
}

function compareOriginalOrder<T>(left: IndexedItem<T>, right: IndexedItem<T>): number {
  return left.index - right.index;
}

function chainComparators<T>(...comparators: readonly Comparator<T>[]): Comparator<T> {
  return (left: IndexedItem<T>, right: IndexedItem<T>): number => {
    for (const comparator of comparators) {
      const result = comparator(left, right);
      if (result !== 0) {
        return result;
      }
    }

    return 0;
  };
}

export function sortFollowingItems<T extends SortableFollowingItem>(
  items: readonly T[],
  mode: SortModeId,
): T[] {
  const indexedItems: IndexedItem<T>[] = items.map((item, index) => ({
    item,
    index,
  }));

  const apiSortComparator = chainComparators(compareApiSortRankAsc, compareOriginalOrder);

  const comparatorByMode: Record<SortModeId, Comparator<T>> = {
    [SORT_MODES.RECOMMEND]: apiSortComparator,
    [SORT_MODES.POPULAR]: apiSortComparator,
    [SORT_MODES.UNPOPULAR]: apiSortComparator,
    [SORT_MODES.LATEST]: apiSortComparator,
    [SORT_MODES.OLDEST]: apiSortComparator,
  };

  return indexedItems.sort(comparatorByMode[mode]).map((entry) => entry.item);
}
