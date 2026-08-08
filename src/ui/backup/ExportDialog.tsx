import { Download, FileArchive, FileJson } from 'lucide-react';
import type { BookmarkNode } from '../../bookmarks/types';

export type NativeExportFormat = 'json' | 'zip';

interface ExportDialogProps {
  roots: BookmarkNode[];
  selectedRootIds: string[];
  includeThumbnails: boolean;
  estimatedThumbnailBytes: number;
  busy: boolean;
  onSelectedRootIdsChange: (ids: string[]) => void;
  onIncludeThumbnailsChange: (include: boolean) => void;
  onExport: (format: NativeExportFormat) => void;
}

export function ExportDialog({
  roots,
  selectedRootIds,
  includeThumbnails,
  estimatedThumbnailBytes,
  busy,
  onSelectedRootIdsChange,
  onIncludeThumbnailsChange,
  onExport
}: ExportDialogProps) {
  const toggleRoot = (rootId: string) => {
    onSelectedRootIdsChange(
      selectedRootIds.includes(rootId)
        ? selectedRootIds.filter((id) => id !== rootId)
        : [...selectedRootIds, rootId]
    );
  };

  return (
    <fieldset className="backup-export">
      <legend>原生备份范围</legend>
      <div className="backup-roots">
        {roots.map((root) => (
          <label key={root.id}>
            <input
              type="checkbox"
              checked={selectedRootIds.includes(root.id)}
              onChange={() => toggleRoot(root.id)}
            />
            {root.title || '浏览器书签'}
          </label>
        ))}
      </div>
      <label className="inline-control">
        <input
          type="checkbox"
          checked={includeThumbnails}
          onChange={(event) => onIncludeThumbnailsChange(event.target.checked)}
        />
        ZIP 包含缩略图（约 {formatBytes(estimatedThumbnailBytes)}）
      </label>
      <div className="backup-actions">
        <button
          type="button"
          disabled={busy || selectedRootIds.length === 0}
          onClick={() => onExport('json')}
        >
          <FileJson size={16} />
          导出 JSON
        </button>
        <button
          type="button"
          disabled={busy || selectedRootIds.length === 0}
          onClick={() => onExport('zip')}
        >
          <FileArchive size={16} />
          导出 ZIP
        </button>
        <Download size={16} aria-hidden="true" />
      </div>
    </fieldset>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
