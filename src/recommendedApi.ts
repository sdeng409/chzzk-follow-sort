import type { SortModeId } from './sortModes';

const FOLLOWING_LIVES_API_BASE_URL = 'https://api.chzzk.naver.com/service/v1/channels/following-lives';
const CHANNEL_ID_PATTERN = /^[a-z0-9_-]{4,}$/i;
const CACHE_TTL_MS = 30_000;
const MAX_FALLBACK_SCAN_DEPTH = 6;
const ERROR_BACKOFF_MS = 10_000;

interface CachedSortOrder {
  fetchedAtMs: number;
  channelIds: string[];
}

const COMMON_ARRAY_PATHS: ReadonlyArray<ReadonlyArray<string>> = [
  ['content', 'followingLives'],
  ['content', 'followingLiveList'],
  ['content', 'channels'],
  ['content', 'items'],
  ['content', 'list'],
  ['content', 'data'],
  ['followingLives'],
  ['channels'],
  ['items'],
  ['list'],
  ['data'],
];

const cachedSortOrderByType: Partial<Record<SortModeId, CachedSortOrder>> = {};
const inFlightRequestByType: Partial<Record<SortModeId, Promise<readonly string[]>>> = {};
const lastErrorMsByType: Partial<Record<SortModeId, number>> = {};

interface ScanState {
  iterations: number;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isLikelyChannelId(value: unknown): value is string {
  return typeof value === 'string' && CHANNEL_ID_PATTERN.test(value.trim());
}

function dedupeInOrder(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }

    seen.add(value);
    deduped.push(value);
  }

  return deduped;
}

function toChannelId(value: unknown): string | null {
  if (isLikelyChannelId(value)) {
    return value.trim();
  }

  return null;
}

function readPath(source: unknown, path: readonly string[]): unknown {
  let current: unknown = source;
  for (const key of path) {
    if (!isObject(current)) {
      return undefined;
    }

    current = current[key];
  }

  return current;
}

function pickChannelIdFromEntry(entry: unknown): string | null {
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

function extractChannelIdsFromArray(source: readonly unknown[]): string[] {
  const ids: string[] = [];
  for (const item of source) {
    const channelId = pickChannelIdFromEntry(item);
    if (channelId) {
      ids.push(channelId);
    }
  }

  return dedupeInOrder(ids);
}

function collectArraysByDepth(
  value: unknown,
  depth: number,
  result: unknown[][],
  seen: WeakSet<object>,
  state: ScanState,
): void {
  if (depth > MAX_FALLBACK_SCAN_DEPTH || state.iterations > 1000) {
    return;
  }

  state.iterations += 1;

  if (Array.isArray(value)) {
    result.push(value);
    for (const item of value) {
      collectArraysByDepth(item, depth + 1, result, seen, state);
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
    collectArraysByDepth(child, depth + 1, result, seen, state);
  }
}

function extractChannelIdsFromPayload(payload: unknown): string[] {
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

  const arrays: unknown[][] = [];
  const seen = new WeakSet<object>();
  const scanState: ScanState = { iterations: 0 };
  collectArraysByDepth(payload, 0, arrays, seen, scanState);

  let bestCandidate: string[] = [];
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

function buildFollowingLivesUrl(sortType: SortModeId): string {
  const url = new URL(FOLLOWING_LIVES_API_BASE_URL);
  url.searchParams.set('sortType', sortType);
  return url.href;
}

async function requestSortOrder(sortType: SortModeId): Promise<readonly string[]> {
  const response = await fetch(buildFollowingLivesUrl(sortType), {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`following-lives API 호출 실패: sortType=${sortType}, HTTP ${response.status}`);
  }

  const payload = (await response.json()) as unknown;
  return extractChannelIdsFromPayload(payload);
}

export async function fetchFollowingLivesChannelOrder(
  sortType: SortModeId,
  forceRefresh = false,
): Promise<readonly string[]> {
  const cachedSortOrder = cachedSortOrderByType[sortType] ?? null;
  const nowMs = Date.now();
  const lastErrorMs = lastErrorMsByType[sortType] ?? 0;

  if (!forceRefresh && nowMs - lastErrorMs < ERROR_BACKOFF_MS) {
    return cachedSortOrder?.channelIds ?? [];
  }

  if (
    !forceRefresh &&
    cachedSortOrder !== null &&
    nowMs - cachedSortOrder.fetchedAtMs < CACHE_TTL_MS
  ) {
    return cachedSortOrder.channelIds;
  }

  const inFlightRequest = inFlightRequestByType[sortType] ?? null;
  if (!forceRefresh && inFlightRequest !== null) {
    return inFlightRequest;
  }

  const request = requestSortOrder(sortType)
    .then((channelIds) => {
      const normalized = dedupeInOrder(channelIds.filter((channelId) => isLikelyChannelId(channelId)));
      cachedSortOrderByType[sortType] = {
        fetchedAtMs: Date.now(),
        channelIds: normalized,
      };
      return normalized;
    })
    .catch(() => {
      lastErrorMsByType[sortType] = Date.now();
      return cachedSortOrderByType[sortType]?.channelIds ?? [];
    })
    .finally(() => {
      delete inFlightRequestByType[sortType];
    });

  inFlightRequestByType[sortType] = request;
  return request;
}
