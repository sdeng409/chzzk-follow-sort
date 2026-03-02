import { extractFollowingListItems, type FollowingListItem } from './followingDom';
import { sortFollowingItems } from './sortFollowingItems';
import type { SortModeId } from './sortModes';

interface ReorderDomResult {
  itemsCount: number;
  reordered: boolean;
}

interface ReorderDomOptions {
  sortedChannelIds?: readonly string[] | null;
}

const CHANNEL_ID_PATTERN = /^[a-z0-9_-]{4,}$/i;

function isLikelyChannelId(value: string): boolean {
  return CHANNEL_ID_PATTERN.test(value);
}

function getApiSortRankByChannelId(
  channelIds: readonly string[] | null | undefined,
): Map<string, number> {
  const rankByChannelId = new Map<string, number>();
  if (!channelIds || channelIds.length === 0) {
    return rankByChannelId;
  }

  for (let index = 0; index < channelIds.length; index += 1) {
    const channelId = channelIds[index];
    if (!channelId || !isLikelyChannelId(channelId) || rankByChannelId.has(channelId)) {
      continue;
    }

    rankByChannelId.set(channelId, index);
  }

  return rankByChannelId;
}

function getDirectChildIndices(container: HTMLElement): Map<HTMLElement, number> {
  const indexByElement = new Map<HTMLElement, number>();
  const children = Array.from(container.children);

  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (child instanceof HTMLElement) {
      indexByElement.set(child, index);
    }
  }

  return indexByElement;
}

function getItemsInDirectChildDomOrder(
  container: HTMLElement,
  extractedItems: readonly FollowingListItem[],
): FollowingListItem[] {
  const indexByElement = getDirectChildIndices(container);
  const attachedItems: { item: FollowingListItem; index: number }[] = [];
  const detachedItems: FollowingListItem[] = [];

  for (const item of extractedItems) {
    const index = indexByElement.get(item.element);
    if (index === undefined) {
      detachedItems.push(item);
      continue;
    }

    attachedItems.push({ item, index });
  }

  attachedItems.sort((left, right) => left.index - right.index);

  return [...attachedItems.map((entry) => entry.item), ...detachedItems];
}

function getCurrentOrder(
  container: HTMLElement,
  itemElements: ReadonlySet<HTMLElement>,
): HTMLElement[] {
  return Array.from(container.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement && itemElements.has(child),
  );
}

export function reorderFollowingListDom(
  container: HTMLElement,
  mode: SortModeId,
  options: ReorderDomOptions = {},
): ReorderDomResult {
  const extractedItems = extractFollowingListItems(container);
  const domOrderedItems = getItemsInDirectChildDomOrder(container, extractedItems);
  const apiSortRankByChannelId = getApiSortRankByChannelId(options.sortedChannelIds);
  const sortableItems = domOrderedItems.map((item) => {
    const apiSortRank = apiSortRankByChannelId.get(item.key);
    if (apiSortRank === undefined) {
      return item;
    }

    return {
      ...item,
      apiSortRank,
    };
  });
  const sortedItems = sortFollowingItems(sortableItems, mode);

  const desiredElements = sortedItems
    .map((item) => item.element)
    .filter((element) => element.parentElement === container);

  if (desiredElements.length <= 1) {
    return {
      itemsCount: domOrderedItems.length,
      reordered: false,
    };
  }

  const desiredElementSet = new Set(desiredElements);
  const currentOrder = getCurrentOrder(container, desiredElementSet);

  if (currentOrder.length !== desiredElements.length) {
    return {
      itemsCount: domOrderedItems.length,
      reordered: false,
    };
  }

  let isAlreadyOrdered = true;
  for (let index = 0; index < desiredElements.length; index += 1) {
    if (desiredElements[index]?.style.order !== String(index + 1)) {
      isAlreadyOrdered = false;
      break;
    }
  }

  if (isAlreadyOrdered) {
    return {
      itemsCount: domOrderedItems.length,
      reordered: false,
    };
  }

  const computedStyle = window.getComputedStyle(container);
  if (computedStyle.display !== 'flex' && computedStyle.display !== 'grid') {
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
  }

  for (let index = 0; index < desiredElements.length; index += 1) {
    const element = desiredElements[index];
    if (element) {
      element.style.order = String(index + 1);
    }
  }

  return {
    itemsCount: domOrderedItems.length,
    reordered: true,
  };
}
