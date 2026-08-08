const DRAFT_PREFIX = 'siftmark.note-draft.';

export interface NoteDraft {
  id: string;
  text: string;
  title: string;
  url: string;
  createdAt: number;
  truncated: boolean;
}

export interface DraftStorageArea {
  get(keys?: null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

export class ChromeNoteDraftRepository {
  constructor(private readonly storage: DraftStorageArea) {}

  async list(): Promise<NoteDraft[]> {
    const values = await this.storage.get(null);
    return Object.entries(values).flatMap(([key, value]) => key.startsWith(DRAFT_PREFIX) && isDraft(value) ? [value] : []).sort((left, right) => right.createdAt - left.createdAt);
  }

  async put(draft: NoteDraft): Promise<void> {
    await this.storage.set({ [`${DRAFT_PREFIX}${draft.id}`]: { ...draft, text: draft.text.slice(0, 2_000), truncated: draft.truncated || draft.text.length > 2_000 } });
  }

  remove(id: string): Promise<void> {
    return this.storage.remove(`${DRAFT_PREFIX}${id}`);
  }
}

function isDraft(value: unknown): value is NoteDraft {
  if (typeof value !== 'object' || value === null) return false;
  const draft = value as Partial<NoteDraft>;
  return typeof draft.id === 'string' && typeof draft.text === 'string' && typeof draft.title === 'string' && typeof draft.url === 'string' && typeof draft.createdAt === 'number' && typeof draft.truncated === 'boolean';
}
