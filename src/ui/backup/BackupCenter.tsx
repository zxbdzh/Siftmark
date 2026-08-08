import { Upload } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { exportNativeBackup } from '../../backup/native-exporter';
import { parseNativeBackup } from '../../backup/native-importer';
import { parseNetscapeBookmarkFile } from '../../backup/netscape-html-importer';
import { parseMarkAiBackupFile } from '../../backup/markai-importer';
import type { ImportGraph } from '../../backup/types';
import type { BookmarkRepository } from '../../bookmarks/ports';
import { isBookmark, type BookmarkNode } from '../../bookmarks/types';
import type { SiftmarkDatabase } from '../../storage/database';
import type { ThumbnailRecord } from '../../storage/schema';
import type { BookmarkMetadata } from '../../storage/types';
import { ExportDialog, type NativeExportFormat } from './ExportDialog';

interface BackupCenterProps {
  bookmarks: BookmarkRepository;
  database: SiftmarkDatabase;
  appVersion: string;
  onImportParsed?: (graph: ImportGraph) => void;
}

interface ExportSource {
  nodes: BookmarkNode[];
  metadata: Map<string, BookmarkMetadata>;
  thumbnails: ThumbnailRecord[];
}

export function BackupCenter({
  bookmarks,
  database,
  appVersion,
  onImportParsed
}: BackupCenterProps) {
  const [source, setSource] = useState<ExportSource>({
    nodes: [],
    metadata: new Map(),
    thumbnails: []
  });
  const [selectedRootIds, setSelectedRootIds] = useState<string[]>([]);
  const [includeThumbnails, setIncludeThumbnails] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [preview, setPreview] = useState<ImportGraph | null>(null);

  useEffect(() => {
    void Promise.all([
      bookmarks.getTree(),
      database.bookmarkMetadata.toArray(),
      database.thumbnails.toArray()
    ]).then(([nodes, metadata, thumbnails]) => {
      const roots = findExportRoots(nodes);
      setSource({
        nodes,
        metadata: new Map(metadata.map((item) => [item.bookmarkId, item])),
        thumbnails
      });
      setSelectedRootIds(roots.map((root) => root.id));
    });
  }, [bookmarks, database]);

  const roots = useMemo(() => findExportRoots(source.nodes), [source.nodes]);
  const estimatedThumbnailBytes = useMemo(() => {
    const selectedIds = collectSelectedIds(source.nodes, selectedRootIds);
    return source.thumbnails.reduce(
      (total, thumbnail) =>
        total +
        (selectedIds.has(thumbnail.bookmarkId)
          ? (thumbnail.blob?.size ?? 0)
          : 0),
      0
    );
  }, [selectedRootIds, source.nodes, source.thumbnails]);

  const exportBackup = async (format: NativeExportFormat) => {
    setBusy(true);
    setStatus('正在生成并校验备份');
    try {
      const [operations, settings] = await Promise.all([
        database.operationLog.toArray(),
        browser.storage.local.get(null)
      ]);
      const result = await exportNativeBackup({
        ...source,
        operations,
        settings,
        selectedRootIds,
        includeThumbnails: format === 'zip' && includeThumbnails,
        appVersion
      });
      downloadBlob(
        format === 'zip' ? result.zip : result.json,
        `siftmark-${new Date().toISOString().slice(0, 10)}.${format}`
      );
      setStatus('备份已通过校验并开始下载');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '备份生成失败');
    } finally {
      setBusy(false);
    }
  };

  const parseImport = async (file: File) => {
    setBusy(true);
    setStatus('正在本地解析文件');
    try {
      const graph = await parseSelectedFile(file);
      setPreview(graph);
      onImportParsed?.(graph);
      setStatus('文件已解析，尚未写入书签');
    } catch (error) {
      setPreview(null);
      setStatus(error instanceof Error ? error.message : '无法解析此文件');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <h2>备份与迁移</h2>
      <p>普通备份不包含 API Key；导入文件会先在本地解析和预览。</p>
      <ExportDialog
        roots={roots}
        selectedRootIds={selectedRootIds}
        includeThumbnails={includeThumbnails}
        estimatedThumbnailBytes={estimatedThumbnailBytes}
        busy={busy}
        onSelectedRootIdsChange={setSelectedRootIds}
        onIncludeThumbnailsChange={setIncludeThumbnails}
        onExport={(format) => void exportBackup(format)}
      />
      <label className="backup-import">
        <Upload size={16} />
        选择本地备份文件
        <input
          type="file"
          accept=".json,.zip,.html,.htm,.siftmark-backup"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void parseImport(file);
            event.target.value = '';
          }}
        />
      </label>
      <output aria-live="polite">{status}</output>
      {preview ? (
        <dl className="backup-preview">
          <div>
            <dt>格式</dt>
            <dd>{formatLabel(preview.format)}</dd>
          </div>
          <div>
            <dt>文件夹</dt>
            <dd>
              {preview.nodes.filter((node) => node.kind === 'folder').length}
            </dd>
          </div>
          <div>
            <dt>书签</dt>
            <dd>
              {preview.nodes.filter((node) => node.kind === 'bookmark').length}
            </dd>
          </div>
          <div>
            <dt>完整性</dt>
            <dd>{preview.integrity === 'verified' ? '已校验' : '待确认'}</dd>
          </div>
          <div>
            <dt>未知字段</dt>
            <dd>{preview.unknownFields.length}</dd>
          </div>
        </dl>
      ) : null}
    </section>
  );
}

async function parseSelectedFile(file: File): Promise<ImportGraph> {
  const name = file.name.toLocaleLowerCase();
  if (name.endsWith('.html') || name.endsWith('.htm'))
    return parseNetscapeBookmarkFile(file);
  if (name.endsWith('.zip') || name.endsWith('.siftmark-backup'))
    return parseNativeBackup(file);
  if (name.endsWith('.json')) {
    const text = await file.text();
    try {
      const value = JSON.parse(text) as { manifest?: { format?: string } };
      if (value.manifest?.format === 'siftmark-backup')
        return parseNativeBackup(text);
    } catch {
      throw new Error('invalid-json-backup');
    }
    return parseMarkAiBackupFile(file);
  }
  throw new Error('unsupported-backup-format');
}

function findExportRoots(nodes: BookmarkNode[]): BookmarkNode[] {
  const root = nodes.find((node) => node.parentId === '' || node.id === '0');
  const rootId = root?.id ?? '0';
  return nodes.filter((node) => node.parentId === rootId && !isBookmark(node));
}

function collectSelectedIds(
  nodes: BookmarkNode[],
  roots: string[]
): Set<string> {
  const selected = new Set(roots);
  let added = true;
  while (added) {
    added = false;
    for (const node of nodes) {
      if (selected.has(node.parentId) && !selected.has(node.id)) {
        selected.add(node.id);
        added = true;
      }
    }
  }
  return selected;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function formatLabel(format: ImportGraph['format']): string {
  if (format === 'siftmark') return 'Siftmark';
  if (format === 'markai') return 'MarkAI';
  return '浏览器 HTML';
}
