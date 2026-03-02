import { fetchFollowingLivesChannelOrder } from './recommendedApi';
import { reorderFollowingListDom } from './reorderDom';
import { SORT_MODES, type SortModeId } from './sortModes';
import { persistSortMode, readPersistedSortMode } from './storage';

const DEBUG = false;
const EXTENSION_ROOT_ID = 'chzzk-follow-sort-ext-root';
const NAVIGATION_EVENT = 'chzzk-follow-sort:navigation';
const BOOTSTRAP_FLAG = '__CHZZK_FOLLOW_SORT_BOOTSTRAPPED__';
const NAV_HOOK_FLAG = '__CHZZK_FOLLOW_SORT_NAV_HOOKED__';
const DEFAULT_SORT_MODE = SORT_MODES.RECOMMEND;
const SORT_UI_FLAG_ATTR = 'data-chzzk-follow-sort-ui';
const SORT_SELECT_FLAG_ATTR = 'data-chzzk-follow-sort-select';
const REORDER_GUARD_MS = 150;
const FOLLOWING_HEADING_PATTERN = /(팔로잉\s*채널|following\s*channels?)/i;
const FOLLOWING_TEXT_PATTERN = /(팔로잉|following)/i;

type ChzzkWindow = Window & {
  [BOOTSTRAP_FLAG]?: boolean;
  [NAV_HOOK_FLAG]?: boolean;
};

interface ScoredCandidate {
  container: HTMLElement;
  score: number;
}

function debugLog(message: string, payload?: unknown): void {
  if (!DEBUG) {
    return;
  }

  console.debug('[chzzk-follow-sort]', message, payload);
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function isChzzkHost(hostname: string): boolean {
  return hostname === 'chzzk.naver.com' || hostname.endsWith('.chzzk.naver.com');
}

function isElementVisible(element: HTMLElement): boolean {
  if (!element.isConnected) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function getRouteHintScore(pathname: string): number {
  const normalizedPath = pathname.toLowerCase();

  if (normalizedPath.includes('following')) {
    return 2;
  }

  if (normalizedPath.includes('follow')) {
    return 1;
  }

  return 0;
}

function isLikelyChannelLinkHref(rawHref: string): boolean {
  try {
    const url = new URL(rawHref, window.location.href);
    if (!isChzzkHost(url.hostname)) {
      return false;
    }

    if (url.searchParams.has('channelId')) {
      return true;
    }

    const pathname = url.pathname.toLowerCase();
    return pathname.includes('/live/') || pathname.includes('/channel/');
  } catch {
    return false;
  }
}

function countChannelLinkLikeChildren(candidate: HTMLElement): {
  directChildren: HTMLElement[];
  channelLinkLikeChildrenCount: number;
} {
  const directChildren = Array.from(candidate.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement,
  );

  let channelLinkLikeChildrenCount = 0;
  for (const child of directChildren) {
    const anchor = child.querySelector<HTMLAnchorElement>('a[href]');
    if (!anchor) {
      continue;
    }

    const href = normalizeText(anchor.getAttribute('href')) || anchor.href;
    if (href && isLikelyChannelLinkHref(href)) {
      channelLinkLikeChildrenCount += 1;
    }
  }

  return {
    directChildren,
    channelLinkLikeChildrenCount,
  };
}

function getCandidateScore(candidate: HTMLElement, scopeHintScore: number): number | null {
  if (candidate.id === EXTENSION_ROOT_ID) {
    return null;
  }

  if (!isElementVisible(candidate)) {
    return null;
  }

  const childCount = candidate.children.length;
  if (childCount < 3 || childCount > 220) {
    return null;
  }

  const { directChildren, channelLinkLikeChildrenCount } = countChannelLinkLikeChildren(candidate);
  if (channelLinkLikeChildrenCount < 3) {
    return null;
  }

  const density = channelLinkLikeChildrenCount / Math.max(1, directChildren.length);
  const listTagBonus = candidate.tagName === 'UL' || candidate.tagName === 'OL' ? 6 : 0;
  return scopeHintScore + density * 20 + channelLinkLikeChildrenCount * 4 + listTagBonus;
}

function findBestContainerInScope(scope: HTMLElement, scopeHintScore: number): ScoredCandidate | null {
  const candidates = [scope, ...Array.from(scope.querySelectorAll<HTMLElement>('section, ul, ol, div'))];
  let best: ScoredCandidate | null = null;

  for (const candidate of candidates) {
    const score = getCandidateScore(candidate, scopeHintScore);
    if (score === null) {
      continue;
    }

    if (best === null || score > best.score) {
      best = {
        container: candidate,
        score,
      };
    }
  }

  return best;
}

function findSidebarFollowingContainer(): HTMLElement | null {
  const scopes = Array.from(
    document.querySelectorAll<HTMLElement>("aside, nav, [role='navigation']"),
  );
  let best: ScoredCandidate | null = null;

  for (const scope of scopes) {
    const scopeText = normalizeText(scope.textContent);
    if (!FOLLOWING_TEXT_PATTERN.test(scopeText)) {
      continue;
    }

    const headingBonus = FOLLOWING_HEADING_PATTERN.test(scopeText) ? 260 : 120;
    const navBonus =
      scope.tagName === 'ASIDE' || scope.tagName === 'NAV' || scope.getAttribute('role') === 'navigation'
        ? 24
        : 0;

    const candidate = findBestContainerInScope(scope, headingBonus + navBonus);
    if (!candidate) {
      continue;
    }

    if (best === null || candidate.score > best.score) {
      best = candidate;
    }
  }

  return best?.container ?? null;
}

function findFollowingPageContainer(): HTMLElement | null {
  const routeHintScore = getRouteHintScore(window.location.pathname);
  if (routeHintScore === 0) {
    return null;
  }

  const main = document.querySelector<HTMLElement>("main, [role='main']");
  if (!main) {
    return null;
  }

  const best = findBestContainerInScope(main, routeHintScore * 120);
  return best?.container ?? null;
}

function findFollowingListContainer(): HTMLElement | null {
  const sidebarContainer = findSidebarFollowingContainer();
  if (sidebarContainer) {
    return sidebarContainer;
  }

  const followingPageContainer = findFollowingPageContainer();
  if (followingPageContainer) {
    return followingPageContainer;
  }

  return null;
}

function getUiHost(container: HTMLElement): HTMLElement {
  if (container.tagName !== 'UL' && container.tagName !== 'OL') {
    return container;
  }

  return container.parentElement ?? container;
}

function ensureExtensionRoot(container: HTMLElement): HTMLElement {
  const uiHost = getUiHost(container);
  const existingRoot = document.getElementById(EXTENSION_ROOT_ID);
  const root = existingRoot ?? document.createElement('div');

  if (!existingRoot) {
    root.id = EXTENSION_ROOT_ID;
  }

  if (root.parentElement === uiHost) {
    return root;
  }

  if (uiHost === container) {
    uiHost.prepend(root);
  } else {
    uiHost.insertBefore(root, container);
  }

  return root;
}

function isSortModeId(value: string | null): value is (typeof SORT_MODES)[keyof typeof SORT_MODES] {
  if (value === null) {
    return false;
  }

  return (Object.values(SORT_MODES) as string[]).includes(value);
}

function getSelectedSortMode(root: HTMLElement): (typeof SORT_MODES)[keyof typeof SORT_MODES] {
  const rootMode = root.getAttribute('data-sort-mode');
  return isSortModeId(rootMode) ? rootMode : DEFAULT_SORT_MODE;
}

function resolveInitialSortMode(
  root: HTMLElement,
  persistedSortMode: SortModeId | null,
  hasLoadedPersistedSortMode: boolean,
): SortModeId {
  const rootMode = root.getAttribute('data-sort-mode');
  if (isSortModeId(rootMode)) {
    return rootMode;
  }

  if (hasLoadedPersistedSortMode && persistedSortMode !== null && isSortModeId(persistedSortMode)) {
    return persistedSortMode;
  }

  return DEFAULT_SORT_MODE;
}

function ensureSortModeUi(
  root: HTMLElement,
  container: HTMLElement,
  handlers: {
    onSortModeChange: (mode: SortModeId) => void;
    getSortedChannelIds: (mode: SortModeId) => readonly string[];
    requestSortRefresh: (mode: SortModeId, forceRefresh: boolean) => void;
  },
): void {
  let ui = root.querySelector<HTMLElement>(`[${SORT_UI_FLAG_ATTR}='1']`);

  if (!ui) {
    ui = document.createElement('div');
    ui.setAttribute(SORT_UI_FLAG_ATTR, '1');
    ui.style.display = 'flex';
    ui.style.alignItems = 'center';
    ui.style.justifyContent = 'space-between';
    ui.style.gap = '10px';
    ui.style.width = '100%';
    ui.style.boxSizing = 'border-box';
    ui.style.padding = '5px';
    ui.style.margin = '0 0 8px 0';
    ui.style.fontSize = '13px';
    ui.style.lineHeight = '1.2';
    ui.style.fontFamily = 'Pretendard';
    root.style.width = '100%';
    root.style.boxSizing = 'border-box';

    const label = document.createElement('label');
    label.textContent = '정렬';
    label.style.fontWeight = '600';
    label.style.color = '#697183';
    label.style.flex = '0 0 auto';

    const select = document.createElement('select');
    select.setAttribute(SORT_SELECT_FLAG_ATTR, '1');
    select.style.padding = '4px 20px 4px 0';
    select.style.fontSize = '13px';
    select.style.fontFamily = 'Pretendard';
    select.style.border = '1px solid rgba(255, 255, 255, 0.22)';
    select.style.borderRadius = '4px';
    select.style.background = 'rgba(18, 21, 28, 0.92)';
    select.style.setProperty('appearance', 'none');
    select.style.setProperty('-webkit-appearance', 'none');
    select.style.setProperty('-moz-appearance', 'none');
    select.style.backgroundRepeat = 'no-repeat';
    select.style.backgroundPosition = 'right 6px center';
    select.style.backgroundSize = '10px 6px';
    select.style.backgroundImage =
      "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6'%3E%3Cpath fill='%23f6f8fd' d='M1 1l4 4 4-4'/%3E%3C/svg%3E\")";
    select.style.color = '#f6f8fd';
    select.style.marginLeft = 'auto';
    select.style.minWidth = '96px';

    const options: Array<{ value: SortModeId; label: string }> = [
      { value: SORT_MODES.RECOMMEND, label: '추천순' },
      { value: SORT_MODES.POPULAR, label: '시청자 많은 순' },
      { value: SORT_MODES.UNPOPULAR, label: '시청자 적은 순' },
      { value: SORT_MODES.LATEST, label: '최신 라이브 순' },
      { value: SORT_MODES.OLDEST, label: '오래된 라이브 순' },
    ];

    for (const optionData of options) {
      const option = document.createElement('option');
      option.value = optionData.value;
      option.textContent = optionData.label;
      select.append(option);
    }

    ui.append(label);
    ui.append(select);
    root.append(ui);
  }

  const select = ui.querySelector<HTMLSelectElement>(`select[${SORT_SELECT_FLAG_ATTR}='1']`);
  if (!select) {
    return;
  }

  select.value = getSelectedSortMode(root);

  select.onchange = () => {
    const nextMode = isSortModeId(select.value) ? select.value : DEFAULT_SORT_MODE;
    handlers.requestSortRefresh(nextMode, true);

    const { itemsCount } = reorderFollowingListDom(container, nextMode, {
      sortedChannelIds: handlers.getSortedChannelIds(nextMode),
    });

    root.setAttribute('data-item-count', String(itemsCount));
    root.setAttribute('data-sort-mode', nextMode);
    handlers.onSortModeChange(nextMode);
  };
}

function installNavigationHooks(onNavigate: () => void): void {
  const win = window as ChzzkWindow;
  if (win[NAV_HOOK_FLAG]) {
    return;
  }

  win[NAV_HOOK_FLAG] = true;

  const emitNavigation = (): void => {
    window.dispatchEvent(new Event(NAVIGATION_EVENT));
  };

  const originalPushState = history.pushState;
  history.pushState = function pushState(...args: Parameters<History['pushState']>): void {
    originalPushState.apply(this, args);
    emitNavigation();
  };

  const originalReplaceState = history.replaceState;
  history.replaceState = function replaceState(...args: Parameters<History['replaceState']>): void {
    originalReplaceState.apply(this, args);
    emitNavigation();
  };

  window.addEventListener(NAVIGATION_EVENT, onNavigate);
  window.addEventListener('popstate', onNavigate);
  window.addEventListener('hashchange', onNavigate);
}

function bootstrap(): void {
  if (!isChzzkHost(window.location.hostname)) {
    return;
  }

  const win = window as ChzzkWindow;
  if (win[BOOTSTRAP_FLAG]) {
    return;
  }

  win[BOOTSTRAP_FLAG] = true;

  let scheduled = false;
  let reorderGuardUntil = 0;
  let persistedSortMode: SortModeId | null = null;
  let hasLoadedPersistedSortMode = false;
  let userSelectionVersion = 0;
  let sortedChannelIdsByMode: Partial<Record<SortModeId, readonly string[]>> = {};
  const loadedModes = new Set<SortModeId>();
  const requestInFlightModes = new Set<SortModeId>();
  let cachedContainer: HTMLElement | null = null;

  const isInReorderGuardWindow = (): boolean => Date.now() < reorderGuardUntil;

  const scheduleAttach = (): void => {
    if (scheduled) {
      return;
    }

    scheduled = true;
    window.setTimeout(() => {
      scheduled = false;
      runAttach();
    }, 50);
  };

  const requestSortOrder = (mode: SortModeId, forceRefresh: boolean): void => {
    if (requestInFlightModes.has(mode)) {
      return;
    }

    requestInFlightModes.add(mode);
    void fetchFollowingLivesChannelOrder(mode, forceRefresh)
      .then((channelIds) => {
        sortedChannelIdsByMode = {
          ...sortedChannelIdsByMode,
          [mode]: channelIds,
        };
        loadedModes.add(mode);
        debugLog('following-lives sortType 채널 수신', {
          mode,
          count: channelIds.length,
          forceRefresh,
        });
      })
      .catch(() => {
        if (!loadedModes.has(mode)) {
          sortedChannelIdsByMode = {
            ...sortedChannelIdsByMode,
            [mode]: [],
          };
          loadedModes.add(mode);
        }
      })
      .finally(() => {
        requestInFlightModes.delete(mode);
        scheduleAttach();
      });
  };

  const runAttach = (): void => {
    if (isInReorderGuardWindow()) {
      return;
    }

    let container = cachedContainer;
    if (!container || !document.body.contains(container) || container.children.length === 0) {
      container = findFollowingListContainer();
      cachedContainer = container;
    }

    if (!container) {
      return;
    }

    const root = ensureExtensionRoot(container);
    const selectedMode = resolveInitialSortMode(
      root,
      persistedSortMode,
      hasLoadedPersistedSortMode,
    );
    root.setAttribute('data-sort-mode', selectedMode);

    ensureSortModeUi(root, container, {
      onSortModeChange: (mode) => {
        userSelectionVersion += 1;
        persistedSortMode = mode;
        void persistSortMode(mode);
        debugLog('selected sort mode changed', { mode });
      },
      getSortedChannelIds: (mode) => sortedChannelIdsByMode[mode] ?? [],
      requestSortRefresh: (mode, forceRefresh) => {
        requestSortOrder(mode, forceRefresh);
      },
    });

    if (!loadedModes.has(selectedMode)) {
      requestSortOrder(selectedMode, false);
    }

    const { itemsCount, reordered } = reorderFollowingListDom(container, selectedMode, {
      sortedChannelIds: sortedChannelIdsByMode[selectedMode] ?? null,
    });

    if (reordered) {
      reorderGuardUntil = Date.now() + REORDER_GUARD_MS;
    }

    root.setAttribute('data-item-count', String(itemsCount));
    root.setAttribute('data-sort-mode', selectedMode);

    debugLog('extracted following items', {
      itemCount: itemsCount,
      mode: selectedMode,
      reordered,
    });
  };

  const observer = new MutationObserver(() => {
    scheduleAttach();
  });

  if (document.documentElement) {
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
    });
  }

  installNavigationHooks(() => {
    const root = document.getElementById(EXTENSION_ROOT_ID);
    const activeMode = root ? getSelectedSortMode(root) : persistedSortMode ?? DEFAULT_SORT_MODE;
    requestSortOrder(activeMode, false);

    scheduleAttach();
  });

  const initialReadSelectionVersion = userSelectionVersion;
  void readPersistedSortMode()
    .then((storedMode) => {
      if (userSelectionVersion !== initialReadSelectionVersion) {
        return;
      }

      if (storedMode !== null && isSortModeId(storedMode)) {
        persistedSortMode = storedMode;
        requestSortOrder(storedMode, false);
      }
    })
    .catch(() => {
      persistedSortMode = null;
    })
    .finally(() => {
      hasLoadedPersistedSortMode = true;
      scheduleAttach();
    });

  runAttach();
}

bootstrap();
