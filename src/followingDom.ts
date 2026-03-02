export interface FollowingListItem {
  key: string;
  name: string;
  href: string;
  element: HTMLElement;
  isLive?: boolean;
  viewerCount?: number;
}

const LIVE_TEXT_PATTERN = /\b(live|on\s*air)\b|라이브|생방/i;
const VIEWER_COUNT_PATTERNS = [
  /(?:시청자|watching|viewers?)\s*([0-9][0-9,.]*)\s*(만)?/i,
  /([0-9][0-9,.]*)\s*(만)?\s*(?:명\s*)?(?:시청|watching|viewers?)/i,
];

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function toAbsoluteHref(rawHref: string): string {
  try {
    return new URL(rawHref, window.location.href).href;
  } catch {
    return rawHref;
  }
}

function parseChannelIdFromHref(href: string): string | null {
  try {
    const url = new URL(href, window.location.href);
    const directParam = normalizeText(url.searchParams.get('channelId'));
    if (directParam.length >= 4) {
      return directParam;
    }

    const segments = url.pathname
      .split('/')
      .map((segment) => decodeURIComponent(segment))
      .map((segment) => normalizeText(segment))
      .filter((segment) => segment.length > 0);

    for (let index = 0; index < segments.length; index += 1) {
      const current = segments[index]?.toLowerCase();
      const next = segments[index + 1];

      if ((current === 'live' || current === 'channel') && next && /^[a-z0-9_-]{4,}$/i.test(next)) {
        return next;
      }
    }

    const tail = segments.at(-1);
    if (tail && /^[a-z0-9_-]{4,}$/i.test(tail)) {
      return tail;
    }

    return null;
  } catch {
    return null;
  }
}

function findTopLevelItemElement(container: HTMLElement, fromElement: Element): HTMLElement | null {
  let current: HTMLElement | null =
    fromElement instanceof HTMLElement ? fromElement : fromElement.parentElement;

  while (current && current.parentElement && current.parentElement !== container) {
    current = current.parentElement;
  }

  if (!current || current.parentElement !== container) {
    return null;
  }

  return current;
}

function pickPrimaryAnchor(itemElement: HTMLElement): HTMLAnchorElement | null {
  const anchors = Array.from(itemElement.querySelectorAll<HTMLAnchorElement>('a[href]'));
  if (anchors.length === 0) {
    return null;
  }

  const preferredAnchor = anchors.find((anchor) => {
    const href = normalizeText(anchor.getAttribute('href'));
    return /chzzk\.naver\.com/i.test(href) || /\/live\//i.test(href) || /\/channel\//i.test(href);
  });

  return preferredAnchor ?? anchors[0] ?? null;
}

function extractName(itemElement: HTMLElement, anchor: HTMLAnchorElement): string {
  const candidates = [
    anchor.getAttribute('aria-label'),
    anchor.textContent,
    anchor.querySelector<HTMLImageElement>('img[alt]')?.alt,
    itemElement.querySelector<HTMLImageElement>('img[alt]')?.alt,
  ];

  for (const candidate of candidates) {
    const text = normalizeText(candidate);
    if (text.length >= 2) {
      return text;
    }
  }

  return '';
}

function parseViewerCount(rawText: string): number | undefined {
  const text = normalizeText(rawText);
  if (!text) {
    return undefined;
  }

  for (const pattern of VIEWER_COUNT_PATTERNS) {
    const matched = pattern.exec(text);
    if (!matched) {
      continue;
    }

    const numericPart = (matched[1] ?? '').replace(/,/g, '').trim();
    const baseValue = Number(numericPart);
    if (!Number.isFinite(baseValue)) {
      continue;
    }

    const scale = matched[2] === '만' ? 10_000 : 1;
    return Math.round(baseValue * scale);
  }

  return undefined;
}

export function extractFollowingListItems(container: HTMLElement): FollowingListItem[] {
  try {
    const anchors = Array.from(container.querySelectorAll<HTMLAnchorElement>('a[href]'));
    if (anchors.length === 0) {
      return [];
    }

    const uniqueElements = new Set<HTMLElement>();
    for (const anchor of anchors) {
      const itemElement = findTopLevelItemElement(container, anchor);
      if (!itemElement || itemElement.id === 'chzzk-follow-sort-ext-root') {
        continue;
      }

      uniqueElements.add(itemElement);
    }

    const items: FollowingListItem[] = [];
    let index = 0;

    for (const itemElement of uniqueElements) {
      const anchor = pickPrimaryAnchor(itemElement);
      if (!anchor) {
        continue;
      }

      const rawHref = normalizeText(anchor.getAttribute('href'));
      const href = rawHref ? toAbsoluteHref(rawHref) : '';
      const channelId = href ? parseChannelIdFromHref(href) : null;
      const key = channelId ?? (href || `index-${index}`);
      const name = extractName(itemElement, anchor);

      const itemText = normalizeText(itemElement.textContent);
      const isLive = LIVE_TEXT_PATTERN.test(itemText) ? true : undefined;
      const viewerCount = isLive ? parseViewerCount(itemText) : undefined;

      items.push({
        key,
        name,
        href,
        element: itemElement,
        ...(isLive !== undefined ? { isLive } : {}),
        ...(viewerCount !== undefined ? { viewerCount } : {}),
      });
      index += 1;
    }

    return items;
  } catch {
    return [];
  }
}
