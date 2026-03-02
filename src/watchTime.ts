export const WATCH_STATS_STORAGE_KEY = 'chzzkFollowSort.watchStats.v1';

const DEBUG = false;
const MIN_STORAGE_WRITE_INTERVAL_MS = 30_000;
const TICK_INTERVAL_MS = 5_000;
const MIN_CHANNEL_ID_LENGTH = 4;
const CHANNEL_ID_PATTERN = /^[a-z0-9_-]{4,}$/i;

type StorageGetCallback = (items: Record<string, unknown>) => void;
type StorageSetCallback = () => void;

type StorageAreaLike = {
  get: (
    keys: string | string[] | Record<string, unknown> | null,
    callback: StorageGetCallback,
  ) => void;
  set: (items: Record<string, unknown>, callback?: StorageSetCallback) => void;
};

type ChromeLike = {
  storage?: {
    local?: StorageAreaLike;
  };
  runtime?: {
    lastError?: Error;
  };
};

interface WatchStatEntry {
  totalWatchMs: number;
  updatedAtMs: number;
}

type WatchStatsByChannelId = Record<string, WatchStatEntry>;

export type WatchStatsSnapshot = Record<string, WatchStatEntry>;

export interface WatchTimeTracker {
  handleRouteChange: () => void;
  stop: () => void;
}

let inMemoryWatchStats: WatchStatsByChannelId = {};

export function getWatchStatsSnapshot(): WatchStatsSnapshot {
  const snapshotEntries = Object.entries(inMemoryWatchStats).map(([channelId, entry]) => [
    channelId,
    { ...entry },
  ]);
  return Object.fromEntries(snapshotEntries);
}

function debugLog(message: string, payload?: unknown): void {
  if (!DEBUG) {
    return;
  }

  console.debug('[chzzk-follow-sort:watch-time]', message, payload);
}

function getChromeLike(): ChromeLike | null {
  const globalScope = globalThis as { chrome?: unknown };
  if (!globalScope.chrome || typeof globalScope.chrome !== 'object') {
    return null;
  }

  return globalScope.chrome as ChromeLike;
}

function getStorageArea(): StorageAreaLike | null {
  return getChromeLike()?.storage?.local ?? null;
}

function getRuntimeError(): Error | undefined {
  return getChromeLike()?.runtime?.lastError;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function sanitizeEntry(value: unknown): WatchStatEntry | null {
  if (!isObject(value)) {
    return null;
  }

  const rawTotalWatchMs = value.totalWatchMs;
  const rawUpdatedAtMs = value.updatedAtMs;
  if (
    typeof rawTotalWatchMs !== 'number' ||
    !Number.isFinite(rawTotalWatchMs) ||
    rawTotalWatchMs < 0
  ) {
    return null;
  }

  if (
    typeof rawUpdatedAtMs !== 'number' ||
    !Number.isFinite(rawUpdatedAtMs) ||
    rawUpdatedAtMs < 0
  ) {
    return null;
  }

  return {
    totalWatchMs: Math.floor(rawTotalWatchMs),
    updatedAtMs: Math.floor(rawUpdatedAtMs),
  };
}

function sanitizeWatchStats(value: unknown): WatchStatsByChannelId {
  if (!isObject(value)) {
    return {};
  }

  const sanitized: WatchStatsByChannelId = {};
  const entries = Object.entries(value);

  for (const [channelId, rawEntry] of entries) {
    if (!isLikelyChannelId(channelId)) {
      continue;
    }

    const entry = sanitizeEntry(rawEntry);
    if (!entry) {
      continue;
    }

    sanitized[channelId] = entry;
  }

  return sanitized;
}

function readStoredWatchStats(): Promise<WatchStatsByChannelId> {
  const storageArea = getStorageArea();
  if (!storageArea) {
    return Promise.resolve({ ...inMemoryWatchStats });
  }

  return new Promise<WatchStatsByChannelId>((resolve) => {
    try {
      storageArea.get(WATCH_STATS_STORAGE_KEY, (items) => {
        const runtimeError = getRuntimeError();
        if (runtimeError) {
          resolve({ ...inMemoryWatchStats });
          return;
        }

        const storedValue = items[WATCH_STATS_STORAGE_KEY];
        resolve(sanitizeWatchStats(storedValue));
      });
    } catch {
      resolve({ ...inMemoryWatchStats });
    }
  });
}

function writeStoredWatchStats(nextStats: WatchStatsByChannelId): Promise<boolean> {
  inMemoryWatchStats = { ...nextStats };

  const storageArea = getStorageArea();
  if (!storageArea) {
    return Promise.resolve(false);
  }

  return new Promise<boolean>((resolve) => {
    try {
      storageArea.set({ [WATCH_STATS_STORAGE_KEY]: nextStats }, () => {
        const runtimeError = getRuntimeError();
        resolve(!runtimeError);
      });
    } catch {
      resolve(false);
    }
  });
}

function isChzzkHost(hostname: string): boolean {
  return hostname === 'chzzk.naver.com' || hostname.endsWith('.chzzk.naver.com');
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function isLikelyChannelId(value: string | null | undefined): value is string {
  return Boolean(value && value.length >= MIN_CHANNEL_ID_LENGTH && CHANNEL_ID_PATTERN.test(value));
}

function parseChannelIdFromUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl, window.location.href);
    if (!isChzzkHost(url.hostname)) {
      return null;
    }

    const directParam = normalizeText(url.searchParams.get('channelId'));
    if (isLikelyChannelId(directParam)) {
      return directParam;
    }

    const segments = url.pathname
      .split('/')
      .map((segment) => decodeURIComponent(segment))
      .map((segment) => normalizeText(segment))
      .filter((segment) => segment.length > 0);
    if (segments.length === 0) {
      return null;
    }

    let hasLiveSegment = false;
    for (let index = 0; index < segments.length; index += 1) {
      const current = segments[index]?.toLowerCase();
      const next = segments[index + 1];
      const previous = segments[index - 1];

      if (current === 'live') {
        hasLiveSegment = true;
        if (isLikelyChannelId(next)) {
          return next;
        }

        if (isLikelyChannelId(previous)) {
          return previous;
        }

        continue;
      }

      if (current === 'channel' && isLikelyChannelId(next)) {
        return next;
      }
    }

    if (!hasLiveSegment) {
      return null;
    }

    const tail = segments.at(-1);
    return isLikelyChannelId(tail) ? tail : null;
  } catch {
    return null;
  }
}

function parseChannelIdFromPage(): string | null {
  try {
    const canonicalHref = normalizeText(
      document.querySelector<HTMLLinkElement>("link[rel='canonical']")?.href,
    );
    if (canonicalHref) {
      const parsedFromCanonical = parseChannelIdFromUrl(canonicalHref);
      if (parsedFromCanonical) {
        return parsedFromCanonical;
      }
    }

    const rootChannelId = normalizeText(
      document.querySelector<HTMLElement>('[data-channel-id]')?.dataset.channelId,
    );
    if (isLikelyChannelId(rootChannelId)) {
      return rootChannelId;
    }

    return null;
  } catch {
    return null;
  }
}

function resolveLiveChannelId(): string | null {
  const fromLocation = parseChannelIdFromUrl(window.location.href);
  if (fromLocation) {
    return fromLocation;
  }

  return parseChannelIdFromPage();
}

export function startWatchTimeTracker(): WatchTimeTracker {
  let stopped = false;
  let currentChannelId: string | null = null;
  let activeSincePerfMs: number | null = null;
  let watchStats: WatchStatsByChannelId = { ...inMemoryWatchStats };
  let lastPersistAtMs = 0;
  let hasDirtyChanges = false;
  let persistInFlight = false;

  const applyElapsedToCurrentChannel = (): void => {
    if (activeSincePerfMs === null || currentChannelId === null) {
      return;
    }

    const nowPerfMs = performance.now();
    const elapsedMs = Math.max(0, Math.floor(nowPerfMs - activeSincePerfMs));
    activeSincePerfMs = nowPerfMs;
    if (elapsedMs <= 0) {
      return;
    }

    const nowMs = Date.now();
    const previous = watchStats[currentChannelId];
    const nextEntry: WatchStatEntry = {
      totalWatchMs: (previous?.totalWatchMs ?? 0) + elapsedMs,
      updatedAtMs: nowMs,
    };
    watchStats = {
      ...watchStats,
      [currentChannelId]: nextEntry,
    };
    hasDirtyChanges = true;
  };

  const persistIfNeeded = async (force: boolean): Promise<void> => {
    if (stopped || persistInFlight || !hasDirtyChanges) {
      return;
    }

    const nowMs = Date.now();
    if (!force && nowMs - lastPersistAtMs < MIN_STORAGE_WRITE_INTERVAL_MS) {
      return;
    }

    persistInFlight = true;
    try {
      await writeStoredWatchStats(watchStats);
      lastPersistAtMs = nowMs;
      hasDirtyChanges = false;
      debugLog('watch stats persisted', {
        channels: Object.keys(watchStats).length,
      });
    } finally {
      persistInFlight = false;
    }
  };

  const isTrackingActive = (): boolean => {
    if (stopped || document.visibilityState !== 'visible') {
      return false;
    }

    return currentChannelId !== null;
  };

  const syncActiveState = (): void => {
    const shouldBeActive = isTrackingActive();
    if (shouldBeActive) {
      if (activeSincePerfMs === null) {
        activeSincePerfMs = performance.now();
      }

      return;
    }

    applyElapsedToCurrentChannel();
    activeSincePerfMs = null;
  };

  const updateChannelFromRoute = (): void => {
    const nextChannelId = resolveLiveChannelId();
    if (nextChannelId === currentChannelId) {
      syncActiveState();
      return;
    }

    applyElapsedToCurrentChannel();
    activeSincePerfMs = null;
    currentChannelId = nextChannelId;
    debugLog('active channel changed', { currentChannelId });
    syncActiveState();
  };

  void readStoredWatchStats()
    .then((stored) => {
      if (stopped) {
        return;
      }

      watchStats = { ...stored, ...watchStats };
      inMemoryWatchStats = { ...watchStats };
    })
    .catch(() => {
      watchStats = { ...inMemoryWatchStats, ...watchStats };
      inMemoryWatchStats = { ...watchStats };
    });

  const tick = (): void => {
    if (stopped) {
      return;
    }

    updateChannelFromRoute();
    if (activeSincePerfMs !== null) {
      applyElapsedToCurrentChannel();
    }

    void persistIfNeeded(false);
  };

  updateChannelFromRoute();

  const intervalId = window.setInterval(tick, TICK_INTERVAL_MS);

  const onVisibilityChange = (): void => {
    syncActiveState();
    if (document.visibilityState !== 'visible') {
      void persistIfNeeded(true);
    }
  };

  const onPageHide = (): void => {
    syncActiveState();
    void persistIfNeeded(true);
  };

  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('beforeunload', onPageHide);

  return {
    handleRouteChange: () => {
      if (stopped) {
        return;
      }

      updateChannelFromRoute();
      void persistIfNeeded(false);
    },
    stop: () => {
      if (stopped) {
        return;
      }

      stopped = true;
      syncActiveState();
      void persistIfNeeded(true);
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('beforeunload', onPageHide);
    },
  };
}
