import { LockKeyhole, Upload } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { ProfileRepository } from '../../ai/profiles/profile-repository';
import {
  exportEncryptedCompleteConfiguration,
  parseEncryptedCompleteConfiguration
} from '../../backup/config-exporter';
import {
  detectImportConflicts,
  type ImportConflict
} from '../../backup/conflict-detector';
import {
  applyImportPlan,
  createImportTask,
  type ImportApplicationTaskInput,
  DexieImportRecoveryRepository
} from '../../backup/import-application-service';
import {
  createImportPlan,
  type ImportDecision
} from '../../backup/import-plan';
import { readBlobBytes } from '../../backup/blob';
import { exportNativeBackup } from '../../backup/native-exporter';
import { parseNativeBackup } from '../../backup/native-importer';
import { parseNetscapeBookmarkFile } from '../../backup/netscape-html-importer';
import { parseMarkAiBackupFile } from '../../backup/markai-importer';
import type { ImportGraph } from '../../backup/types';
import type { BookmarkRepository } from '../../bookmarks/ports';
import { isBookmark, type BookmarkNode } from '../../bookmarks/types';
import { BookmarkCommandService } from '../../operations/bookmark-command-service';
import { DexieOperationRepository } from '../../operations/operation-repository';
import type { SiftmarkDatabase } from '../../storage/database';
import { DexieMetadataRepository } from '../../storage/metadata-repository';
import type { ThumbnailRecord } from '../../storage/schema';
import type { BookmarkMetadata } from '../../storage/types';
import { DexieTaskRepository } from '../../tasks/task-repository';
import type { DurableTask } from '../../tasks/types';
import { ExportDialog, type NativeExportFormat } from './ExportDialog';
import { ImportPreview } from './ImportPreview';

interface BackupCenterProps {
  bookmarks: BookmarkRepository;
  database: SiftmarkDatabase;
  profiles: ProfileRepository;
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
  profiles,
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
  const [conflicts, setConflicts] = useState<ImportConflict[]>([]);
  const [destinationParentId, setDestinationParentId] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPassword, setImportPassword] = useState('');
  const [pausedTask, setPausedTask] =
    useState<DurableTask<ImportApplicationTaskInput> | null>(null);

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
      setDestinationParentId((current) => current || roots[0]?.id || '');
    });
  }, [bookmarks, database]);

  useEffect(() => {
    void new DexieTaskRepository(database)
      .listByState(['paused'])
      .then((tasks) =>
        setPausedTask(
          (tasks
            .filter((task) => task.type === 'backup-import')
            .sort((left, right) => right.updatedAt - left.updatedAt)[0] as
            DurableTask<ImportApplicationTaskInput> | undefined) ?? null
        )
      );
  }, [database]);

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
      const graph = await parseSelectedFile(file, importPassword);
      const metadataRepository = new DexieMetadataRepository(database);
      const [existingNodes, existingMetadata] = await Promise.all([
        bookmarks.getTree(),
        metadataRepository.list()
      ]);
      setPreview(graph);
      setConflicts(
        detectImportConflicts(
          graph,
          existingNodes,
          new Map(existingMetadata.map((item) => [item.bookmarkId, item]))
        )
      );
      onImportParsed?.(graph);
      setStatus('文件已解析，尚未写入书签');
      if (file.name.toLocaleLowerCase().endsWith('.siftmark-backup'))
        setImportPassword('');
    } catch (error) {
      setPreview(null);
      setConflicts([]);
      setStatus(error instanceof Error ? error.message : '无法解析此文件');
    } finally {
      setBusy(false);
    }
  };

  const applyDecisions = async (decisions: Record<string, ImportDecision>) => {
    if (!preview || !destinationParentId) {
      setStatus('请选择导入目标文件夹');
      return;
    }
    setBusy(true);
    setStatus('正在创建恢复点并导入');
    try {
      const metadataRepository = new DexieMetadataRepository(database);
      const taskRepository = new DexieTaskRepository(database);
      const commandService = new BookmarkCommandService(
        bookmarks,
        new DexieOperationRepository(database),
        metadataRepository
      );
      const plan = createImportPlan(
        preview,
        conflicts,
        decisions,
        destinationParentId
      );
      const task = createImportTask(plan);
      await taskRepository.put(task);
      const result = await applyImportPlan(task.id, {
        bookmarks,
        commands: commandService,
        metadata: metadataRepository,
        tasks: taskRepository,
        recoveryPoints: new DexieImportRecoveryRepository(database),
        configuration: browser.storage.local
      });
      setPausedTask(result.state === 'paused' ? result : null);
      setStatus(
        result.state === 'succeeded'
          ? `已导入 ${result.completed} 个项目`
          : `导入暂停：已完成 ${result.completed} 个，失败 ${result.failed} 个`
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '导入失败');
    } finally {
      setBusy(false);
    }
  };

  const resumePausedImport = async () => {
    if (!pausedTask) return;
    setBusy(true);
    setStatus('正在继续上次导入');
    try {
      const metadataRepository = new DexieMetadataRepository(database);
      const taskRepository = new DexieTaskRepository(database);
      const result = await applyImportPlan(pausedTask.id, {
        bookmarks,
        commands: new BookmarkCommandService(
          bookmarks,
          new DexieOperationRepository(database),
          metadataRepository
        ),
        metadata: metadataRepository,
        tasks: taskRepository,
        recoveryPoints: new DexieImportRecoveryRepository(database),
        configuration: browser.storage.local
      });
      setPausedTask(result.state === 'paused' ? result : null);
      setStatus(
        result.state === 'succeeded'
          ? `导入已继续并完成，共 ${result.completed} 个项目`
          : `导入仍暂停：${result.input.failures.at(-1)?.message ?? '请检查失败项目'}`
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '无法继续导入');
    } finally {
      setBusy(false);
    }
  };

  const exportCompleteConfiguration = async () => {
    if (password.length < 8) {
      setStatus('完整配置密码至少需要 8 个字符');
      return;
    }
    if (password !== passwordConfirmation) {
      setStatus('两次输入的密码不一致');
      return;
    }
    setBusy(true);
    setStatus('正在加密完整配置');
    try {
      const [operations, settings, modelProfiles] = await Promise.all([
        database.operationLog.toArray(),
        browser.storage.local.get(null),
        profiles.list()
      ]);
      const native = await exportNativeBackup({
        ...source,
        operations,
        settings,
        selectedRootIds,
        includeThumbnails,
        appVersion
      });
      const archive = await exportEncryptedCompleteConfiguration(
        {
          profiles: modelProfiles,
          settings,
          nativeBackup: await readBlobBytes(native.zip)
        },
        password
      );
      downloadBlob(
        archive,
        `siftmark-complete-${new Date().toISOString().slice(0, 10)}.siftmark-backup`
      );
      setPassword('');
      setPasswordConfirmation('');
      setStatus('加密完整配置已开始下载');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '完整配置导出失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section id="backup-center">
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
      <fieldset className="backup-encrypted">
        <legend>加密完整配置</legend>
        <label>
          密码
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <label>
          确认密码
          <input
            type="password"
            autoComplete="new-password"
            value={passwordConfirmation}
            onChange={(event) => setPasswordConfirmation(event.target.value)}
          />
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={() => void exportCompleteConfiguration()}
        >
          <LockKeyhole size={16} />
          导出加密归档
        </button>
      </fieldset>
      <div className="backup-import-controls">
        <label className="backup-import">
          <Upload size={16} />
          {importFile?.name ?? '选择本地备份文件'}
          <input
            type="file"
            accept=".json,.zip,.html,.htm,.siftmark-backup"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              setImportFile(file);
              setPreview(null);
              setConflicts([]);
              setStatus(file ? '文件已选择，等待本地解析' : '');
              event.target.value = '';
            }}
          />
        </label>
        <label className="backup-import-password">
          加密归档密码
          <input
            type="password"
            autoComplete="current-password"
            value={importPassword}
            onChange={(event) => setImportPassword(event.target.value)}
          />
        </label>
        <button
          type="button"
          disabled={busy || !importFile}
          onClick={() => importFile && void parseImport(importFile)}
        >
          本地解析
        </button>
      </div>
      <output aria-live="polite">{status}</output>
      {pausedTask ? (
        <div className="paused-import">
          <span>
            上次导入停在第 {pausedTask.completed + 1} 项：
            {pausedTask.input.failures.at(-1)?.message ?? '等待继续'}
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() => void resumePausedImport()}
          >
            继续上次导入
          </button>
        </div>
      ) : null}
      {preview ? (
        <div className="backup-import-plan">
          <label>
            导入目标
            <select
              value={destinationParentId}
              onChange={(event) => setDestinationParentId(event.target.value)}
            >
              {roots.map((root) => (
                <option key={root.id} value={root.id}>
                  {root.title}
                </option>
              ))}
            </select>
          </label>
          <ImportPreview
            key={`${preview.format}:${preview.version}:${preview.nodes.length}`}
            graph={preview}
            conflicts={conflicts}
            onConfirm={(decisions) => void applyDecisions(decisions)}
          />
        </div>
      ) : null}
    </section>
  );
}

async function parseSelectedFile(
  file: File,
  password: string
): Promise<ImportGraph> {
  const name = file.name.toLocaleLowerCase();
  if (name.endsWith('.html') || name.endsWith('.htm'))
    return parseNetscapeBookmarkFile(file);
  if (name.endsWith('.siftmark-backup')) {
    if (!password) throw new Error('backup-password-required');
    return parseEncryptedCompleteConfiguration(file, password);
  }
  if (name.endsWith('.zip')) return parseNativeBackup(file);
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
