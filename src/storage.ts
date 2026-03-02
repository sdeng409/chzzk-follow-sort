import type { SortModeId } from './sortModes';

export const SORT_MODE_STORAGE_KEY = 'chzzkFollowSort.sortMode';

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
    sync?: StorageAreaLike;
    local?: StorageAreaLike;
  };
  runtime?: {
    lastError?: Error;
  };
};

type ReadResult = {
  value: unknown;
  ok: boolean;
};

let inMemorySortMode: SortModeId | null = null;

function getChromeLike(): ChromeLike | null {
  const globalScope = globalThis as { chrome?: unknown };
  if (!globalScope.chrome || typeof globalScope.chrome !== 'object') {
    return null;
  }

  return globalScope.chrome as ChromeLike;
}

function getAvailableStorageAreas(): StorageAreaLike[] {
  const chromeApi = getChromeLike();
  const areas: StorageAreaLike[] = [];

  if (chromeApi?.storage?.sync) {
    areas.push(chromeApi.storage.sync);
  }

  if (chromeApi?.storage?.local) {
    areas.push(chromeApi.storage.local);
  }

  return areas;
}

function getChromeRuntimeError(): Error | undefined {
  return getChromeLike()?.runtime?.lastError;
}

function readFromArea(area: StorageAreaLike, key: string): Promise<ReadResult> {
  return new Promise<ReadResult>((resolve) => {
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

function writeToArea(area: StorageAreaLike, key: string, value: SortModeId): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
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

export async function readPersistedSortMode(): Promise<SortModeId | null> {
  const storageAreas = getAvailableStorageAreas();

  for (const area of storageAreas) {
    const { value, ok } = await readFromArea(area, SORT_MODE_STORAGE_KEY);
    if (!ok) {
      continue;
    }

    if (typeof value === 'string') {
      return value as SortModeId;
    }
  }

  return inMemorySortMode;
}

export async function persistSortMode(mode: SortModeId): Promise<void> {
  inMemorySortMode = mode;

  const storageAreas = getAvailableStorageAreas();
  for (const area of storageAreas) {
    const ok = await writeToArea(area, SORT_MODE_STORAGE_KEY, mode);
    if (ok) {
      return;
    }
  }
}

export function setSortModeInMemory(mode: SortModeId): void {
  inMemorySortMode = mode;
}
