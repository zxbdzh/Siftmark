import type { BookmarkRepository } from '../bookmarks/ports';
import type { BookmarkNode } from '../bookmarks/types';
import type { BookmarkMetadata, MetadataRepository } from '../storage/types';
import { err, ok, type Result } from '../utils/result';
import type { OperationRepository } from './operation-repository';
import type { OperationError, OperationRecord } from './types';

export interface MoveCommand {
  bookmarkId: string;
  parentId: string;
  index?: number;
  batchId?: string;
  batchIndex?: number;
  expected?: { parentId: string; index: number };
  specialFolderPlacement?: {
    before: object | null;
    after: object | null;
  };
}

export interface RenameCommand {
  bookmarkId: string;
  title: string;
  batchId?: string;
  batchIndex?: number;
  expectedTitle?: string;
}

export interface CreateCommand extends Omit<BookmarkNode, 'id'> {
  batchId?: string;
  batchIndex?: number;
  idempotencyKey?: string;
}

export interface AdoptCreatedCommand {
  bookmarkId: string;
  batchId?: string;
  batchIndex?: number;
  idempotencyKey: string;
}

export interface RemoveCommand {
  bookmarkId: string;
  batchId?: string;
  batchIndex?: number;
  expected?: BookmarkNode;
}

export class BookmarkCommandService {
  constructor(
    private readonly bookmarks: BookmarkRepository,
    private readonly operations: OperationRepository,
    private readonly metadata?: MetadataRepository,
    private readonly now: () => number = Date.now,
    private readonly createId: () => string = () => crypto.randomUUID()
  ) {}

  async create(
    command: CreateCommand
  ): Promise<Result<OperationRecord, OperationError>> {
    if (command.idempotencyKey) {
      const existing = await this.operations.getByIdempotencyKey(
        command.idempotencyKey
      );
      if (existing) return ok(existing);
    }
    const created = await this.bookmarks.create({
      parentId: command.parentId,
      index: command.index,
      title: command.title,
      ...(command.url ? { url: command.url } : {}),
      ...(command.dateAdded ? { dateAdded: command.dateAdded } : {})
    });
    return this.record(
      {
        type: 'create',
        bookmarkId: created.id,
        batchId: command.batchId,
        batchIndex: command.batchIndex,
        before: {},
        after: {
          parentId: created.parentId,
          index: created.index,
          title: created.title,
          ...(created.url ? { url: created.url } : {})
        }
      },
      command.idempotencyKey
    );
  }

  async adoptCreated(
    command: AdoptCreatedCommand
  ): Promise<Result<OperationRecord, OperationError>> {
    const recorded = await this.operations.getByIdempotencyKey(
      command.idempotencyKey
    );
    if (recorded) return ok(recorded);
    const created = await this.bookmarks.get(command.bookmarkId);
    if (!created) return err({ code: 'not_found', id: command.bookmarkId });
    return this.record(
      {
        type: 'create',
        bookmarkId: created.id,
        batchId: command.batchId,
        batchIndex: command.batchIndex,
        before: {},
        after: {
          parentId: created.parentId,
          index: created.index,
          title: created.title,
          ...(created.url ? { url: created.url } : {})
        }
      },
      command.idempotencyKey
    );
  }

  async move(
    command: MoveCommand
  ): Promise<Result<OperationRecord, OperationError>> {
    const current = await this.bookmarks.get(command.bookmarkId);
    if (!current) return err({ code: 'not_found', id: command.bookmarkId });
    if (
      command.expected &&
      (current.parentId !== command.expected.parentId ||
        current.index !== command.expected.index)
    ) {
      return err({
        code: 'conflict',
        bookmarkId: command.bookmarkId,
        expected: command.expected,
        actual: current
      });
    }
    const moved = await this.bookmarks.move(
      command.bookmarkId,
      command.parentId,
      command.index
    );
    return this.record({
      type: 'move',
      bookmarkId: command.bookmarkId,
      batchId: command.batchId,
      batchIndex: command.batchIndex,
      before: {
        parentId: current.parentId,
        index: current.index,
        ...(command.specialFolderPlacement
          ? { specialFolderPlacement: command.specialFolderPlacement.before }
          : {})
      },
      after: {
        parentId: moved.parentId,
        index: moved.index,
        ...(command.specialFolderPlacement
          ? { specialFolderPlacement: command.specialFolderPlacement.after }
          : {})
      }
    });
  }

  async rename(
    command: RenameCommand
  ): Promise<Result<OperationRecord, OperationError>> {
    const current = await this.bookmarks.get(command.bookmarkId);
    if (!current) return err({ code: 'not_found', id: command.bookmarkId });
    if (
      command.expectedTitle !== undefined &&
      current.title !== command.expectedTitle
    ) {
      return err({
        code: 'conflict',
        bookmarkId: command.bookmarkId,
        expected: { title: command.expectedTitle },
        actual: current
      });
    }
    const updated = await this.bookmarks.update(command.bookmarkId, {
      title: command.title
    });
    return this.record({
      type: 'rename',
      bookmarkId: command.bookmarkId,
      batchId: command.batchId,
      batchIndex: command.batchIndex,
      before: { title: current.title },
      after: { title: updated.title }
    });
  }

  async remove(
    command: RemoveCommand
  ): Promise<Result<OperationRecord, OperationError>> {
    const current = await this.bookmarks.get(command.bookmarkId);
    if (!current) return err({ code: 'not_found', id: command.bookmarkId });
    if (command.expected && !sameBookmark(current, command.expected)) {
      return err({
        code: 'conflict',
        bookmarkId: command.bookmarkId,
        expected: snapshot(command.expected),
        actual: snapshot(current)
      });
    }
    await this.bookmarks.remove(command.bookmarkId);
    return this.record({
      type: 'remove',
      bookmarkId: command.bookmarkId,
      batchId: command.batchId,
      batchIndex: command.batchIndex,
      before: snapshot(current),
      after: {}
    });
  }

  async updateMetadata(
    next: BookmarkMetadata,
    batchId?: string,
    batchIndex?: number
  ): Promise<Result<OperationRecord, OperationError>> {
    if (!this.metadata) return err({ code: 'unsupported', type: 'metadata' });
    const before = await this.metadata.get(next.bookmarkId);
    await this.metadata.put(next);
    return this.record({
      type: 'metadata',
      bookmarkId: next.bookmarkId,
      batchId,
      batchIndex,
      before: before ? { metadata: before } : {},
      after: { metadata: next }
    });
  }

  private async record(
    input: Omit<OperationRecord, 'id' | 'idempotencyKey' | 'createdAt'>,
    providedIdempotencyKey?: string
  ): Promise<Result<OperationRecord, OperationError>> {
    const id = this.createId();
    const idempotencyKey = providedIdempotencyKey ?? this.createId();
    const operation: OperationRecord = {
      ...input,
      id,
      idempotencyKey,
      createdAt: this.now()
    };
    await this.operations.put(operation);
    return ok(operation);
  }
}

function snapshot(bookmark: BookmarkNode): Record<string, unknown> {
  return {
    parentId: bookmark.parentId,
    index: bookmark.index,
    title: bookmark.title,
    ...(bookmark.url ? { url: bookmark.url } : {}),
    ...(bookmark.dateAdded ? { dateAdded: bookmark.dateAdded } : {})
  };
}

function sameBookmark(left: BookmarkNode, right: BookmarkNode): boolean {
  return (
    left.id === right.id &&
    left.parentId === right.parentId &&
    left.index === right.index &&
    left.title === right.title &&
    left.url === right.url
  );
}
