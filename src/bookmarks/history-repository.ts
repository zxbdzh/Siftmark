export interface SmartBookmarkHistoryItem {
  id: string;
  bookmarkId: string;
  title: string;
  url: string;
  category: string;
  timestamp: number;
}

const HISTORY_KEY = 'siftmark.smart-bookmark.history.v1';
const MAX_HISTORY = 500;

export interface HistoryStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export class ChromeSmartBookmarkHistoryRepository {
  constructor(private readonly storage: HistoryStorageArea) {}

  async list(): Promise<SmartBookmarkHistoryItem[]> {
    const value = (await this.storage.get(HISTORY_KEY))[HISTORY_KEY];
    if (!Array.isArray(value)) return [];
    return value.filter(isHistoryItem).sort((a, b) => b.timestamp - a.timestamp);
  }

  async add(item: SmartBookmarkHistoryItem): Promise<void> {
    const current = await this.list();
    await this.storage.set({
      [HISTORY_KEY]: [item, ...current.filter((row) => row.id !== item.id)].slice(
        0,
        MAX_HISTORY
      )
    });
  }

  async remove(id: string): Promise<void> {
    await this.storage.set({
      [HISTORY_KEY]: (await this.list()).filter((item) => item.id !== id)
    });
  }

  clear(): Promise<void> {
    return this.storage.set({ [HISTORY_KEY]: [] });
  }
}

function isHistoryItem(value: unknown): value is SmartBookmarkHistoryItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<SmartBookmarkHistoryItem>;
  return (
    typeof item.id === 'string' &&
    typeof item.bookmarkId === 'string' &&
    typeof item.title === 'string' &&
    typeof item.url === 'string' &&
    typeof item.category === 'string' &&
    typeof item.timestamp === 'number'
  );
}
