import type { BookmarkRepository } from '../bookmarks/ports';
import type { BookmarkMetadata, MetadataRepository } from '../storage/types';
import { err, ok, type Result } from '../utils/result';
import type { OperationRepository } from './operation-repository';
import type { OperationError, OperationRecord } from './types';

export class UndoService {
  constructor(
    private readonly bookmarks: BookmarkRepository,
    private readonly operations: OperationRepository,
    private readonly metadata?: MetadataRepository,
    private readonly now: () => number = Date.now
  ) {}

  async undo(id: string): Promise<Result<OperationRecord, OperationError>> {
    const operation = await this.operations.get(id);
    if (!operation) return err({ code: 'not_found', id });
    if (operation.undoneAt) return ok(operation);

    if (operation.type === 'create') {
      const current = await this.bookmarks.get(operation.bookmarkId);
      if (!matches(current, operation.after, ['parentId', 'index', 'title', 'url'])) return conflict(operation, current);
      await this.bookmarks.remove(operation.bookmarkId);
    } else if (operation.type === 'move') {
      const current = await this.bookmarks.get(operation.bookmarkId);
      if (!matches(current, operation.after, ['parentId', 'index'])) return conflict(operation, current);
      await this.bookmarks.move(operation.bookmarkId, String(operation.before.parentId), Number(operation.before.index));
    } else if (operation.type === 'rename') {
      const current = await this.bookmarks.get(operation.bookmarkId);
      if (!matches(current, operation.after, ['title'])) return conflict(operation, current);
      await this.bookmarks.update(operation.bookmarkId, { title: String(operation.before.title) });
    } else if (operation.type === 'metadata' && this.metadata) {
      const current = await this.metadata.get(operation.bookmarkId);
      const expected = operation.after.metadata as BookmarkMetadata;
      if (JSON.stringify(current) !== JSON.stringify(expected)) return conflict(operation, current);
      const before = operation.before.metadata as BookmarkMetadata | undefined;
      if (before) await this.metadata.put(before);
      else await this.metadata.softDelete(operation.bookmarkId, this.now());
    } else {
      return err({ code: 'unsupported', type: operation.type });
    }

    const undoneAt = this.now();
    await this.operations.markUndone(operation.id, undoneAt);
    return ok({ ...operation, undoneAt });
  }
}

function matches(actual: object | null, expected: Record<string, unknown>, keys: string[]): boolean {
  const record = actual as Record<string, unknown> | null;
  return record !== null && keys.every((key) => record[key] === expected[key]);
}

function conflict(operation: OperationRecord, actual: object | null): Result<never, OperationError> {
  return err({ code: 'conflict', bookmarkId: operation.bookmarkId, expected: operation.after, actual });
}
