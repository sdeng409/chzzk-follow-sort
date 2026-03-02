"use strict";
(() => {
  // src/recommendedApi.ts
  var FOLLOWING_LIVES_API_BASE_URL = "https://api.chzzk.naver.com/service/v1/channels/following-lives";
  var CHANNEL_ID_PATTERN = /^[a-z0-9_-]{4,}$/i;
  var CACHE_TTL_MS = 3e4;
  var MAX_FALLBACK_SCAN_DEPTH = 6;
  var COMMON_ARRAY_PATHS = [
    ["content", "followingLives"],
    ["content", "followingLiveList"],
    ["content", "channels"],
    ["content", "items"],
    ["content", "list"],
    ["content", "data"],
    ["followingLives"],
    ["channels"],
    ["items"],
    ["list"],
    ["data"]
  ];
  var cachedSortOrderByType = {};
  var inFlightRequestByType = {};
  function isObject(value) {
    return typeof value === "object" && value !== null;
  }
  function isLikelyChannelId(value) {
    return typeof value === "string" && CHANNEL_ID_PATTERN.test(value.trim());
  }
  function dedupeInOrder(values) {
    const seen = /* @__PURE__ */ new Set();
    const deduped = [];
    for (const value of values) {
      if (seen.has(value)) {
        continue;
      }
      seen.add(value);
      deduped.push(value);
    }
    return deduped;
  }
  function toChannelId(value) {
    if (isLikelyChannelId(value)) {
      return value.trim();
    }
    return null;
  }
  function readPath(source, path) {
    let current = source;
    for (const key of path) {
      if (!isObject(current)) {
        return void 0;
      }
      current = current[key];
    }
    return current;
  }
  function pickChannelIdFromEntry(entry) {
    if (!isObject(entry)) {
      return null;
    }
    const direct = toChannelId(entry.channelId);
    if (direct) {
      return direct;
    }
    const channelFromChannelNode = isObject(entry.channel) ? toChannelId(entry.channel.channelId) : null;
    if (channelFromChannelNode) {
      return channelFromChannelNode;
    }
    const channelFromLiveNode = isObject(entry.live) ? toChannelId(entry.live.channelId) : null;
    if (channelFromLiveNode) {
      return channelFromLiveNode;
    }
    return null;
  }
  function extractChannelIdsFromArray(source) {
    const ids = [];
    for (const item of source) {
      const channelId = pickChannelIdFromEntry(item);
      if (channelId) {
        ids.push(channelId);
      }
    }
    return dedupeInOrder(ids);
  }
  function collectArraysByDepth(value, depth, result, seen) {
    if (depth > MAX_FALLBACK_SCAN_DEPTH) {
      return;
    }
    if (Array.isArray(value)) {
      result.push(value);
      for (const item of value) {
        collectArraysByDepth(item, depth + 1, result, seen);
      }
      return;
    }
    if (!isObject(value)) {
      return;
    }
    if (seen.has(value)) {
      return;
    }
    seen.add(value);
    for (const child of Object.values(value)) {
      collectArraysByDepth(child, depth + 1, result, seen);
    }
  }
  function extractChannelIdsFromPayload(payload) {
    for (const path of COMMON_ARRAY_PATHS) {
      const valueAtPath = readPath(payload, path);
      if (!Array.isArray(valueAtPath)) {
        continue;
      }
      const ids = extractChannelIdsFromArray(valueAtPath);
      if (ids.length > 0) {
        return ids;
      }
    }
    const arrays = [];
    const seen = /* @__PURE__ */ new WeakSet();
    collectArraysByDepth(payload, 0, arrays, seen);
    let bestCandidate = [];
    let bestCoverage = 0;
    for (const currentArray of arrays) {
      if (currentArray.length === 0) {
        continue;
      }
      const ids = extractChannelIdsFromArray(currentArray);
      if (ids.length === 0) {
        continue;
      }
      const coverage = ids.length / currentArray.length;
      if (ids.length > bestCandidate.length) {
        bestCandidate = ids;
        bestCoverage = coverage;
        continue;
      }
      if (ids.length === bestCandidate.length && coverage > bestCoverage) {
        bestCandidate = ids;
        bestCoverage = coverage;
      }
    }
    return bestCandidate;
  }
  function buildFollowingLivesUrl(sortType) {
    const url = new URL(FOLLOWING_LIVES_API_BASE_URL);
    url.searchParams.set("sortType", sortType);
    return url.href;
  }
  async function requestSortOrder(sortType) {
    const response = await fetch(buildFollowingLivesUrl(sortType), {
      method: "GET",
      credentials: "include",
      cache: "no-store"
    });
    if (!response.ok) {
      throw new Error(`following-lives API \uD638\uCD9C \uC2E4\uD328: sortType=${sortType}, HTTP ${response.status}`);
    }
    const payload = await response.json();
    return extractChannelIdsFromPayload(payload);
  }
  async function fetchFollowingLivesChannelOrder(sortType, forceRefresh = false) {
    const cachedSortOrder = cachedSortOrderByType[sortType] ?? null;
    const nowMs = Date.now();
    if (!forceRefresh && cachedSortOrder !== null && nowMs - cachedSortOrder.fetchedAtMs < CACHE_TTL_MS) {
      return cachedSortOrder.channelIds;
    }
    const inFlightRequest = inFlightRequestByType[sortType] ?? null;
    if (!forceRefresh && inFlightRequest !== null) {
      return inFlightRequest;
    }
    const request = requestSortOrder(sortType).then((channelIds) => {
      const normalized = dedupeInOrder(channelIds.filter((channelId) => isLikelyChannelId(channelId)));
      cachedSortOrderByType[sortType] = {
        fetchedAtMs: Date.now(),
        channelIds: normalized
      };
      return normalized;
    }).catch(() => cachedSortOrderByType[sortType]?.channelIds ?? []).finally(() => {
      delete inFlightRequestByType[sortType];
    });
    inFlightRequestByType[sortType] = request;
    return request;
  }

  // src/followingDom.ts
  var LIVE_TEXT_PATTERN = /\b(live|on\s*air)\b|라이브|생방/i;
  var VIEWER_COUNT_PATTERNS = [
    /(?:시청자|watching|viewers?)\s*([0-9][0-9,.]*)\s*(만)?/i,
    /([0-9][0-9,.]*)\s*(만)?\s*(?:명\s*)?(?:시청|watching|viewers?)/i
  ];
  function normalizeText(value) {
    return (value ?? "").replace(/\s+/g, " ").trim();
  }
  function toAbsoluteHref(rawHref) {
    try {
      return new URL(rawHref, window.location.href).href;
    } catch {
      return rawHref;
    }
  }
  function parseChannelIdFromHref(href) {
    try {
      const url = new URL(href, window.location.href);
      const directParam = normalizeText(url.searchParams.get("channelId"));
      if (directParam.length >= 4) {
        return directParam;
      }
      const segments = url.pathname.split("/").map((segment) => decodeURIComponent(segment)).map((segment) => normalizeText(segment)).filter((segment) => segment.length > 0);
      for (let index = 0; index < segments.length; index += 1) {
        const current = segments[index]?.toLowerCase();
        const next = segments[index + 1];
        if ((current === "live" || current === "channel") && next && /^[a-z0-9_-]{4,}$/i.test(next)) {
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
  function findTopLevelItemElement(container, fromElement) {
    let current = fromElement instanceof HTMLElement ? fromElement : fromElement.parentElement;
    while (current && current.parentElement && current.parentElement !== container) {
      current = current.parentElement;
    }
    if (!current || current.parentElement !== container) {
      return null;
    }
    return current;
  }
  function pickPrimaryAnchor(itemElement) {
    const anchors = Array.from(itemElement.querySelectorAll("a[href]"));
    if (anchors.length === 0) {
      return null;
    }
    const preferredAnchor = anchors.find((anchor) => {
      const href = normalizeText(anchor.getAttribute("href"));
      return /chzzk\.naver\.com/i.test(href) || /\/live\//i.test(href) || /\/channel\//i.test(href);
    });
    return preferredAnchor ?? anchors[0] ?? null;
  }
  function extractName(itemElement, anchor) {
    const candidates = [
      anchor.getAttribute("aria-label"),
      anchor.textContent,
      anchor.querySelector("img[alt]")?.alt,
      itemElement.querySelector("img[alt]")?.alt
    ];
    for (const candidate of candidates) {
      const text = normalizeText(candidate);
      if (text.length >= 2) {
        return text;
      }
    }
    return "";
  }
  function parseViewerCount(rawText) {
    const text = normalizeText(rawText);
    if (!text) {
      return void 0;
    }
    for (const pattern of VIEWER_COUNT_PATTERNS) {
      const matched = pattern.exec(text);
      if (!matched) {
        continue;
      }
      const numericPart = (matched[1] ?? "").replace(/,/g, "").trim();
      const baseValue = Number(numericPart);
      if (!Number.isFinite(baseValue)) {
        continue;
      }
      const scale = matched[2] === "\uB9CC" ? 1e4 : 1;
      return Math.round(baseValue * scale);
    }
    return void 0;
  }
  function extractFollowingListItems(container) {
    try {
      const anchors = Array.from(container.querySelectorAll("a[href]"));
      if (anchors.length === 0) {
        return [];
      }
      const uniqueElements = /* @__PURE__ */ new Set();
      for (const anchor of anchors) {
        const itemElement = findTopLevelItemElement(container, anchor);
        if (!itemElement || itemElement.id === "chzzk-follow-sort-ext-root") {
          continue;
        }
        uniqueElements.add(itemElement);
      }
      const items = [];
      let index = 0;
      for (const itemElement of uniqueElements) {
        const anchor = pickPrimaryAnchor(itemElement);
        if (!anchor) {
          continue;
        }
        const rawHref = normalizeText(anchor.getAttribute("href"));
        const href = rawHref ? toAbsoluteHref(rawHref) : "";
        const channelId = href ? parseChannelIdFromHref(href) : null;
        const key = channelId ?? (href || `index-${index}`);
        const name = extractName(itemElement, anchor);
        const itemText = normalizeText(itemElement.textContent);
        const isLive = LIVE_TEXT_PATTERN.test(itemText) ? true : void 0;
        const viewerCount = isLive ? parseViewerCount(itemText) : void 0;
        items.push({
          key,
          name,
          href,
          element: itemElement,
          ...isLive !== void 0 ? { isLive } : {},
          ...viewerCount !== void 0 ? { viewerCount } : {}
        });
        index += 1;
      }
      return items;
    } catch {
      return [];
    }
  }

  // src/sortModes.ts
  var SORT_MODES = {
    RECOMMEND: "RECOMMEND",
    POPULAR: "POPULAR",
    UNPOPULAR: "UNPOPULAR",
    LATEST: "LATEST",
    OLDEST: "OLDEST"
  };

  // src/sortFollowingItems.ts
  function compareOptionalNumberAsc(leftValue, rightValue) {
    if (leftValue === rightValue) {
      return 0;
    }
    if (leftValue === void 0) {
      return 1;
    }
    if (rightValue === void 0) {
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
  function compareApiSortRankAsc(left, right) {
    return compareOptionalNumberAsc(left.item.apiSortRank, right.item.apiSortRank);
  }
  function compareOriginalOrder(left, right) {
    return left.index - right.index;
  }
  function chainComparators(...comparators) {
    return (left, right) => {
      for (const comparator of comparators) {
        const result = comparator(left, right);
        if (result !== 0) {
          return result;
        }
      }
      return 0;
    };
  }
  function sortFollowingItems(items, mode) {
    const indexedItems = items.map((item, index) => ({
      item,
      index
    }));
    const apiSortComparator = chainComparators(compareApiSortRankAsc, compareOriginalOrder);
    const comparatorByMode = {
      [SORT_MODES.RECOMMEND]: apiSortComparator,
      [SORT_MODES.POPULAR]: apiSortComparator,
      [SORT_MODES.UNPOPULAR]: apiSortComparator,
      [SORT_MODES.LATEST]: apiSortComparator,
      [SORT_MODES.OLDEST]: apiSortComparator
    };
    return indexedItems.sort(comparatorByMode[mode]).map((entry) => entry.item);
  }

  // src/reorderDom.ts
  var CHANNEL_ID_PATTERN2 = /^[a-z0-9_-]{4,}$/i;
  function isLikelyChannelId2(value) {
    return CHANNEL_ID_PATTERN2.test(value);
  }
  function getApiSortRankByChannelId(channelIds) {
    const rankByChannelId = /* @__PURE__ */ new Map();
    if (!channelIds || channelIds.length === 0) {
      return rankByChannelId;
    }
    for (let index = 0; index < channelIds.length; index += 1) {
      const channelId = channelIds[index];
      if (!channelId || !isLikelyChannelId2(channelId) || rankByChannelId.has(channelId)) {
        continue;
      }
      rankByChannelId.set(channelId, index);
    }
    return rankByChannelId;
  }
  function getDirectChildIndices(container) {
    const indexByElement = /* @__PURE__ */ new Map();
    const children = Array.from(container.children);
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index];
      if (child instanceof HTMLElement) {
        indexByElement.set(child, index);
      }
    }
    return indexByElement;
  }
  function getItemsInDirectChildDomOrder(container, extractedItems) {
    const indexByElement = getDirectChildIndices(container);
    const attachedItems = [];
    const detachedItems = [];
    for (const item of extractedItems) {
      const index = indexByElement.get(item.element);
      if (index === void 0) {
        detachedItems.push(item);
        continue;
      }
      attachedItems.push({ item, index });
    }
    attachedItems.sort((left, right) => left.index - right.index);
    return [...attachedItems.map((entry) => entry.item), ...detachedItems];
  }
  function getCurrentOrder(container, itemElements) {
    return Array.from(container.children).filter(
      (child) => child instanceof HTMLElement && itemElements.has(child)
    );
  }
  function reorderFollowingListDom(container, mode, options = {}) {
    const extractedItems = extractFollowingListItems(container);
    const domOrderedItems = getItemsInDirectChildDomOrder(container, extractedItems);
    const apiSortRankByChannelId = getApiSortRankByChannelId(options.sortedChannelIds);
    const sortableItems = domOrderedItems.map((item) => {
      const apiSortRank = apiSortRankByChannelId.get(item.key);
      if (apiSortRank === void 0) {
        return item;
      }
      return {
        ...item,
        apiSortRank
      };
    });
    const sortedItems = sortFollowingItems(sortableItems, mode);
    const desiredElements = sortedItems.map((item) => item.element).filter((element) => element.parentElement === container);
    if (desiredElements.length <= 1) {
      return {
        itemsCount: domOrderedItems.length,
        reordered: false
      };
    }
    const desiredElementSet = new Set(desiredElements);
    const currentOrder = getCurrentOrder(container, desiredElementSet);
    if (currentOrder.length !== desiredElements.length) {
      return {
        itemsCount: domOrderedItems.length,
        reordered: false
      };
    }
    const isAlreadyOrdered = currentOrder.every(
      (element, index) => element === desiredElements[index]
    );
    if (isAlreadyOrdered) {
      return {
        itemsCount: domOrderedItems.length,
        reordered: false
      };
    }
    const fragment = document.createDocumentFragment();
    for (const element of desiredElements) {
      fragment.append(element);
    }
    container.append(fragment);
    return {
      itemsCount: domOrderedItems.length,
      reordered: true
    };
  }

  // src/storage.ts
  var SORT_MODE_STORAGE_KEY = "chzzkFollowSort.sortMode";
  var inMemorySortMode = null;
  function getChromeLike() {
    const globalScope = globalThis;
    if (!globalScope.chrome || typeof globalScope.chrome !== "object") {
      return null;
    }
    return globalScope.chrome;
  }
  function getAvailableStorageAreas() {
    const chromeApi = getChromeLike();
    const areas = [];
    if (chromeApi?.storage?.sync) {
      areas.push(chromeApi.storage.sync);
    }
    if (chromeApi?.storage?.local) {
      areas.push(chromeApi.storage.local);
    }
    return areas;
  }
  function getChromeRuntimeError() {
    return getChromeLike()?.runtime?.lastError;
  }
  function readFromArea(area, key) {
    return new Promise((resolve) => {
      try {
        area.get(key, (items) => {
          const runtimeError = getChromeRuntimeError();
          if (runtimeError) {
            resolve({ value: null, ok: false });
            return;
          }
          resolve({ value: items[key], ok: true });
        });
      } catch {
        resolve({ value: null, ok: false });
      }
    });
  }
  function writeToArea(area, key, value) {
    return new Promise((resolve) => {
      try {
        area.set({ [key]: value }, () => {
          const runtimeError = getChromeRuntimeError();
          resolve(!runtimeError);
        });
      } catch {
        resolve(false);
      }
    });
  }
  async function readPersistedSortMode() {
    const storageAreas = getAvailableStorageAreas();
    for (const area of storageAreas) {
      const { value, ok } = await readFromArea(area, SORT_MODE_STORAGE_KEY);
      if (!ok) {
        continue;
      }
      if (typeof value === "string") {
        return value;
      }
    }
    return inMemorySortMode;
  }
  async function persistSortMode(mode) {
    inMemorySortMode = mode;
    const storageAreas = getAvailableStorageAreas();
    for (const area of storageAreas) {
      const ok = await writeToArea(area, SORT_MODE_STORAGE_KEY, mode);
      if (ok) {
        return;
      }
    }
  }
  function setSortModeInMemory(mode) {
    inMemorySortMode = mode;
  }

  // src/contentScript.ts
  var DEBUG = false;
  var EXTENSION_ROOT_ID = "chzzk-follow-sort-ext-root";
  var NAVIGATION_EVENT = "chzzk-follow-sort:navigation";
  var BOOTSTRAP_FLAG = "__CHZZK_FOLLOW_SORT_BOOTSTRAPPED__";
  var NAV_HOOK_FLAG = "__CHZZK_FOLLOW_SORT_NAV_HOOKED__";
  var DEFAULT_SORT_MODE = SORT_MODES.RECOMMEND;
  var SORT_UI_FLAG_ATTR = "data-chzzk-follow-sort-ui";
  var SORT_SELECT_FLAG_ATTR = "data-chzzk-follow-sort-select";
  var REORDER_GUARD_MS = 150;
  var FOLLOWING_HEADING_PATTERN = /(팔로잉\s*채널|following\s*channels?)/i;
  var FOLLOWING_TEXT_PATTERN = /(팔로잉|following)/i;
  function debugLog(message, payload) {
    if (!DEBUG) {
      return;
    }
    console.debug("[chzzk-follow-sort]", message, payload);
  }
  function normalizeText2(value) {
    return (value ?? "").replace(/\s+/g, " ").trim();
  }
  function isChzzkHost(hostname) {
    return hostname === "chzzk.naver.com" || hostname.endsWith(".chzzk.naver.com");
  }
  function isElementVisible(element) {
    if (!element.isConnected) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }
  function getRouteHintScore(pathname) {
    const normalizedPath = pathname.toLowerCase();
    if (normalizedPath.includes("following")) {
      return 2;
    }
    if (normalizedPath.includes("follow")) {
      return 1;
    }
    return 0;
  }
  function isLikelyChannelLinkHref(rawHref) {
    try {
      const url = new URL(rawHref, window.location.href);
      if (!isChzzkHost(url.hostname)) {
        return false;
      }
      if (url.searchParams.has("channelId")) {
        return true;
      }
      const pathname = url.pathname.toLowerCase();
      return pathname.includes("/live/") || pathname.includes("/channel/");
    } catch {
      return false;
    }
  }
  function countChannelLinkLikeChildren(candidate) {
    const directChildren = Array.from(candidate.children).filter(
      (child) => child instanceof HTMLElement
    );
    let channelLinkLikeChildrenCount = 0;
    for (const child of directChildren) {
      const anchor = child.querySelector("a[href]");
      if (!anchor) {
        continue;
      }
      const href = normalizeText2(anchor.getAttribute("href")) || anchor.href;
      if (href && isLikelyChannelLinkHref(href)) {
        channelLinkLikeChildrenCount += 1;
      }
    }
    return {
      directChildren,
      channelLinkLikeChildrenCount
    };
  }
  function getCandidateScore(candidate, scopeHintScore) {
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
    const listTagBonus = candidate.tagName === "UL" || candidate.tagName === "OL" ? 6 : 0;
    return scopeHintScore + density * 20 + channelLinkLikeChildrenCount * 4 + listTagBonus;
  }
  function findBestContainerInScope(scope, scopeHintScore) {
    const candidates = [scope, ...Array.from(scope.querySelectorAll("section, ul, ol, div"))];
    let best = null;
    for (const candidate of candidates) {
      const score = getCandidateScore(candidate, scopeHintScore);
      if (score === null) {
        continue;
      }
      if (best === null || score > best.score) {
        best = {
          container: candidate,
          score
        };
      }
    }
    return best;
  }
  function findSidebarFollowingContainer() {
    const scopes = Array.from(
      document.querySelectorAll("aside, nav, [role='navigation']")
    );
    let best = null;
    for (const scope of scopes) {
      const scopeText = normalizeText2(scope.textContent);
      if (!FOLLOWING_TEXT_PATTERN.test(scopeText)) {
        continue;
      }
      const headingBonus = FOLLOWING_HEADING_PATTERN.test(scopeText) ? 260 : 120;
      const navBonus = scope.tagName === "ASIDE" || scope.tagName === "NAV" || scope.getAttribute("role") === "navigation" ? 24 : 0;
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
  function findFollowingPageContainer() {
    const routeHintScore = getRouteHintScore(window.location.pathname);
    if (routeHintScore === 0) {
      return null;
    }
    const main = document.querySelector("main, [role='main']");
    if (!main) {
      return null;
    }
    const best = findBestContainerInScope(main, routeHintScore * 120);
    return best?.container ?? null;
  }
  function findFollowingListContainer() {
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
  function getUiHost(container) {
    if (container.tagName !== "UL" && container.tagName !== "OL") {
      return container;
    }
    return container.parentElement ?? container;
  }
  function ensureExtensionRoot(container) {
    const uiHost = getUiHost(container);
    const existingRoot = document.getElementById(EXTENSION_ROOT_ID);
    const root = existingRoot ?? document.createElement("div");
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
  function isSortModeId(value) {
    if (value === null) {
      return false;
    }
    return Object.values(SORT_MODES).includes(value);
  }
  function getSelectedSortMode(root) {
    const rootMode = root.getAttribute("data-sort-mode");
    return isSortModeId(rootMode) ? rootMode : DEFAULT_SORT_MODE;
  }
  function resolveInitialSortMode(root, persistedSortMode, hasLoadedPersistedSortMode) {
    const rootMode = root.getAttribute("data-sort-mode");
    if (isSortModeId(rootMode)) {
      return rootMode;
    }
    if (hasLoadedPersistedSortMode && persistedSortMode !== null && isSortModeId(persistedSortMode)) {
      return persistedSortMode;
    }
    return DEFAULT_SORT_MODE;
  }
  function ensureSortModeUi(root, container, handlers) {
    let ui = root.querySelector(`[${SORT_UI_FLAG_ATTR}='1']`);
    if (!ui) {
      ui = document.createElement("div");
      ui.setAttribute(SORT_UI_FLAG_ATTR, "1");
      ui.style.display = "flex";
      ui.style.alignItems = "center";
      ui.style.justifyContent = "space-between";
      ui.style.gap = "10px";
      ui.style.width = "100%";
      ui.style.boxSizing = "border-box";
      ui.style.padding = "5px";
      ui.style.margin = "0 0 8px 0";
      ui.style.fontSize = "13px";
      ui.style.lineHeight = "1.2";
      ui.style.fontFamily = "Pretendard";
      root.style.width = "100%";
      root.style.boxSizing = "border-box";
      const label = document.createElement("label");
      label.textContent = "\uC815\uB82C";
      label.style.fontWeight = "600";
      label.style.color = "#697183";
      label.style.flex = "0 0 auto";
      const select2 = document.createElement("select");
      select2.setAttribute(SORT_SELECT_FLAG_ATTR, "1");
      select2.style.padding = "4px 20px 4px 0";
      select2.style.fontSize = "13px";
      select2.style.fontFamily = "Pretendard";
      select2.style.border = "1px solid rgba(255, 255, 255, 0.22)";
      select2.style.borderRadius = "4px";
      select2.style.background = "rgba(18, 21, 28, 0.92)";
      select2.style.setProperty("appearance", "none");
      select2.style.setProperty("-webkit-appearance", "none");
      select2.style.setProperty("-moz-appearance", "none");
      select2.style.backgroundRepeat = "no-repeat";
      select2.style.backgroundPosition = "right 6px center";
      select2.style.backgroundSize = "10px 6px";
      select2.style.backgroundImage = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6'%3E%3Cpath fill='%23f6f8fd' d='M1 1l4 4 4-4'/%3E%3C/svg%3E")`;
      select2.style.color = "#f6f8fd";
      select2.style.marginLeft = "auto";
      select2.style.minWidth = "96px";
      const options = [
        { value: SORT_MODES.RECOMMEND, label: "\uCD94\uCC9C\uC21C" },
        { value: SORT_MODES.POPULAR, label: "\uC2DC\uCCAD\uC790 \uB9CE\uC740 \uC21C" },
        { value: SORT_MODES.UNPOPULAR, label: "\uC2DC\uCCAD\uC790 \uC801\uC740 \uC21C" },
        { value: SORT_MODES.LATEST, label: "\uCD5C\uC2E0 \uB77C\uC774\uBE0C \uC21C" },
        { value: SORT_MODES.OLDEST, label: "\uC624\uB798\uB41C \uB77C\uC774\uBE0C \uC21C" }
      ];
      for (const optionData of options) {
        const option = document.createElement("option");
        option.value = optionData.value;
        option.textContent = optionData.label;
        select2.append(option);
      }
      ui.append(label);
      ui.append(select2);
      root.append(ui);
    }
    const select = ui.querySelector(`select[${SORT_SELECT_FLAG_ATTR}='1']`);
    if (!select) {
      return;
    }
    select.value = getSelectedSortMode(root);
    select.onchange = () => {
      const nextMode = isSortModeId(select.value) ? select.value : DEFAULT_SORT_MODE;
      handlers.requestSortRefresh(nextMode, true);
      const { itemsCount } = reorderFollowingListDom(container, nextMode, {
        sortedChannelIds: handlers.getSortedChannelIds(nextMode)
      });
      root.setAttribute("data-item-count", String(itemsCount));
      root.setAttribute("data-sort-mode", nextMode);
      handlers.onSortModeChange(nextMode);
    };
  }
  function installNavigationHooks(onNavigate) {
    const win = window;
    if (win[NAV_HOOK_FLAG]) {
      return;
    }
    win[NAV_HOOK_FLAG] = true;
    const emitNavigation = () => {
      window.dispatchEvent(new Event(NAVIGATION_EVENT));
    };
    const originalPushState = history.pushState;
    history.pushState = function pushState(...args) {
      originalPushState.apply(this, args);
      emitNavigation();
    };
    const originalReplaceState = history.replaceState;
    history.replaceState = function replaceState(...args) {
      originalReplaceState.apply(this, args);
      emitNavigation();
    };
    window.addEventListener(NAVIGATION_EVENT, onNavigate);
    window.addEventListener("popstate", onNavigate);
    window.addEventListener("hashchange", onNavigate);
  }
  function bootstrap() {
    if (!isChzzkHost(window.location.hostname)) {
      return;
    }
    const win = window;
    if (win[BOOTSTRAP_FLAG]) {
      return;
    }
    win[BOOTSTRAP_FLAG] = true;
    let scheduled = false;
    let reorderGuardUntil = 0;
    let persistedSortMode = null;
    let hasLoadedPersistedSortMode = false;
    let userSelectionVersion = 0;
    let sortedChannelIdsByMode = {};
    const loadedModes = /* @__PURE__ */ new Set();
    const requestInFlightModes = /* @__PURE__ */ new Set();
    const isInReorderGuardWindow = () => Date.now() < reorderGuardUntil;
    const scheduleAttach = () => {
      if (scheduled) {
        return;
      }
      scheduled = true;
      window.setTimeout(() => {
        scheduled = false;
        runAttach();
      }, 50);
    };
    const requestSortOrder2 = (mode, forceRefresh) => {
      if (requestInFlightModes.has(mode)) {
        return;
      }
      requestInFlightModes.add(mode);
      void fetchFollowingLivesChannelOrder(mode, forceRefresh).then((channelIds) => {
        sortedChannelIdsByMode = {
          ...sortedChannelIdsByMode,
          [mode]: channelIds
        };
        loadedModes.add(mode);
        debugLog("following-lives sortType \uCC44\uB110 \uC218\uC2E0", {
          mode,
          count: channelIds.length,
          forceRefresh
        });
      }).catch(() => {
        if (!loadedModes.has(mode)) {
          sortedChannelIdsByMode = {
            ...sortedChannelIdsByMode,
            [mode]: []
          };
          loadedModes.add(mode);
        }
      }).finally(() => {
        requestInFlightModes.delete(mode);
        scheduleAttach();
      });
    };
    const runAttach = () => {
      if (isInReorderGuardWindow()) {
        return;
      }
      const container = findFollowingListContainer();
      if (!container) {
        return;
      }
      const root = ensureExtensionRoot(container);
      const selectedMode = resolveInitialSortMode(
        root,
        persistedSortMode,
        hasLoadedPersistedSortMode
      );
      root.setAttribute("data-sort-mode", selectedMode);
      ensureSortModeUi(root, container, {
        onSortModeChange: (mode) => {
          userSelectionVersion += 1;
          persistedSortMode = mode;
          setSortModeInMemory(mode);
          void persistSortMode(mode);
          debugLog("selected sort mode changed", { mode });
        },
        getSortedChannelIds: (mode) => sortedChannelIdsByMode[mode] ?? [],
        requestSortRefresh: (mode, forceRefresh) => {
          requestSortOrder2(mode, forceRefresh);
        }
      });
      if (!loadedModes.has(selectedMode)) {
        requestSortOrder2(selectedMode, false);
      }
      const { itemsCount, reordered } = reorderFollowingListDom(container, selectedMode, {
        sortedChannelIds: sortedChannelIdsByMode[selectedMode] ?? null
      });
      if (reordered) {
        reorderGuardUntil = Date.now() + REORDER_GUARD_MS;
      }
      root.setAttribute("data-item-count", String(itemsCount));
      root.setAttribute("data-sort-mode", selectedMode);
      debugLog("extracted following items", {
        itemCount: itemsCount,
        mode: selectedMode,
        reordered
      });
    };
    const observer = new MutationObserver(() => {
      scheduleAttach();
    });
    if (document.documentElement) {
      observer.observe(document.documentElement, {
        subtree: true,
        childList: true
      });
    }
    installNavigationHooks(() => {
      const root = document.getElementById(EXTENSION_ROOT_ID);
      const activeMode = root ? getSelectedSortMode(root) : persistedSortMode ?? DEFAULT_SORT_MODE;
      requestSortOrder2(activeMode, false);
      scheduleAttach();
    });
    const initialReadSelectionVersion = userSelectionVersion;
    void readPersistedSortMode().then((storedMode) => {
      if (userSelectionVersion !== initialReadSelectionVersion) {
        return;
      }
      if (storedMode !== null && isSortModeId(storedMode)) {
        persistedSortMode = storedMode;
        setSortModeInMemory(storedMode);
        requestSortOrder2(storedMode, false);
      }
    }).catch(() => {
      persistedSortMode = null;
    }).finally(() => {
      hasLoadedPersistedSortMode = true;
      scheduleAttach();
    });
    runAttach();
  }
  bootstrap();
})();
