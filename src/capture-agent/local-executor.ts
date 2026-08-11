import type { BookmarkRepository } from '../bookmarks/ports';
import { isBookmark, type BookmarkNode } from '../bookmarks/types';
import type { SpecialFolderService } from '../bookmarks/special-folders';
import type { BookmarkCommandService } from '../operations/bookmark-command-service';
import type { OperationRecord } from '../operations/types';
import type { UndoService } from '../operations/undo-service';
import type { MetadataRepository } from '../storage/types';
import type { Result } from '../utils/result';
import type {
  CaptureExecutionReceipt,
  CaptureExecutor
} from './capture-agent';
import { getCaptureNewFolderLevelLimit } from './folder-level-policy';
import type { CaptureSession } from './types';

export interface LocalCaptureExecutorDependencies {
  bookmarks: Pick<BookmarkRepository, 'get'>;
  commands: Pick<
    BookmarkCommandService,
    'create' | 'move' | 'rename' | 'updateMetadata' | 'remove'
  >;
  metadata: Pick<MetadataRepository, 'get'>;
  specialFolders: Pick<SpecialFolderService, 'check'>;
  undo: Pick<UndoService, 'undoBatch'>;
  now?: () => number;
  createId?: () => string;
}

export class LocalCaptureExecutor implements CaptureExecutor {
  private readonly now: () => number;
  private readonly createId: () => string;

  constructor(private readonly dependencies: LocalCaptureExecutorDependencies) {
    this.now = dependencies.now ?? Date.now;
    this.createId = dependencies.createId ?? (() => crypto.randomUUID());
  }

  async stageForApproval(
    session: CaptureSession
  ): Promise<{ batchId: string }> {
    const batchId = this.createId();
    const inbox = await this.dependencies.specialFolders.check('inbox');
    if (!inbox.ok || session.sourceSnapshot.parentId === inbox.folder.id)
      return { batchId };
    await requireOperation(
      this.dependencies.commands.move({
        bookmarkId: session.bookmarkId,
        parentId: inbox.folder.id,
        batchId,
        batchIndex: 0,
        expected: {
          parentId: session.sourceSnapshot.parentId,
          index: session.sourceSnapshot.index
        }
      })
    );
    return { batchId };
  }

  async execute(session: CaptureSession): Promise<CaptureExecutionReceipt> {
    if (!session.plan) throw new Error('收藏方案不存在');
    const newFolders = session.plan.destination.newFolders;
    const maxNewFolderLevels = getCaptureNewFolderLevelLimit(
      session.plan.destination
    );
    if (newFolders.length > maxNewFolderLevels)
      throw new Error('当前方案超过设置的目录创建层级，请重新分析');
    const folderTitles = newFolders.map(validFolderTitle);

    const source = await this.dependencies.bookmarks.get(session.bookmarkId);
    if (!sameBookmark(source, session.sourceSnapshot))
      throw new Error('书签已发生变化，请重新分析');

    const batchId = this.createId();
    let batchIndex = 0;
    let destinationId = session.plan.destination.folderId;
    const destination = await this.dependencies.bookmarks.get(destinationId);
    if (!destination || isBookmark(destination))
      throw new Error('目标目录已发生变化，请重新分析');

    for (const [folderIndex, title] of folderTitles.entries()) {
      const operation = await requireOperation(
        this.dependencies.commands.create({
          parentId: destinationId,
          index: 0,
          title,
          batchId,
          batchIndex: batchIndex++,
          idempotencyKey: `capture:${session.id}:folder:${folderIndex}`
        })
      );
      destinationId = operation.bookmarkId;
    }

    const exact = session.plan.relatedBookmarks.find(
      (bookmark) =>
        bookmark.relation === 'exact' && bookmark.id !== session.bookmarkId
    );
    if (exact) {
      const canonical = await this.dependencies.bookmarks.get(exact.id);
      if (!canonical || !isBookmark(canonical))
        throw new Error('重复书签已发生变化，请重新分析');
      batchIndex = await this.applyPlanToBookmark({
        bookmark: canonical,
        destinationId,
        session,
        batchId,
        batchIndex
      });
      await requireOperation(
        this.dependencies.commands.remove({
          bookmarkId: session.bookmarkId,
          batchId,
          batchIndex,
          expected: source as BookmarkNode
        })
      );
      return { batchId, bookmarkId: canonical.id };
    }

    await this.applyPlanToBookmark({
      bookmark: source as BookmarkNode & { url: string },
      destinationId,
      session,
      batchId,
      batchIndex
    });
    return { batchId, bookmarkId: session.bookmarkId };
  }

  undo(batchId: string): Promise<{ completed: number; failed: number }> {
    return this.dependencies.undo.undoBatch(batchId);
  }

  private async applyPlanToBookmark(input: {
    bookmark: BookmarkNode & { url: string };
    destinationId: string;
    session: CaptureSession;
    batchId: string;
    batchIndex: number;
  }): Promise<number> {
    const plan = input.session.plan!;
    let current = input.bookmark;
    let batchIndex = input.batchIndex;
    if (current.parentId !== input.destinationId) {
      await requireOperation(
        this.dependencies.commands.move({
          bookmarkId: current.id,
          parentId: input.destinationId,
          batchId: input.batchId,
          batchIndex: batchIndex++,
          expected: { parentId: current.parentId, index: current.index }
        })
      );
      current = { ...current, parentId: input.destinationId };
    }
    if (current.title !== plan.title) {
      await requireOperation(
        this.dependencies.commands.rename({
          bookmarkId: current.id,
          title: plan.title,
          batchId: input.batchId,
          batchIndex: batchIndex++,
          expectedTitle: current.title
        })
      );
    }
    const previous = await this.dependencies.metadata.get(current.id);
    await requireOperation(
      this.dependencies.commands.updateMetadata(
        {
          bookmarkId: current.id,
          summary: plan.summary || previous?.summary || '',
          tags: unique([...(previous?.tags ?? []), ...plan.tags]),
          note: previous?.note ?? '',
          confidence: plan.confidence,
          reason: plan.reason,
          health: previous?.health ?? 'unchecked',
          updatedAt: this.now()
        },
        input.batchId,
        batchIndex++
      )
    );
    return batchIndex;
  }
}

async function requireOperation(
  result: Promise<Result<OperationRecord, unknown>>
): Promise<OperationRecord> {
  const resolved = await result;
  if (resolved.ok) return resolved.value;
  const code =
    typeof resolved.error === 'object' &&
    resolved.error !== null &&
    'code' in resolved.error
      ? String(resolved.error.code)
      : 'unknown';
  throw new Error(
    code === 'conflict'
      ? '书签已发生变化，请重新分析'
      : '书签操作未完成'
  );
}

function sameBookmark(
  current: BookmarkNode | null,
  expected: BookmarkNode
): current is BookmarkNode & { url: string } {
  return Boolean(
    current &&
      isBookmark(current) &&
      current.id === expected.id &&
      current.parentId === expected.parentId &&
      current.index === expected.index &&
      current.title === expected.title &&
      current.url === expected.url
  );
}

function validFolderTitle(value: string): string {
  const title = value.trim();
  const hasControl = [...title].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
  if (!title || title.length > 64 || /[\\/]/.test(title) || hasControl)
    throw new Error('新目录名称无效');
  return title;
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
