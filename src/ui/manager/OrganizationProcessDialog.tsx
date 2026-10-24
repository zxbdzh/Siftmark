import { ArrowLeft, CheckCircle2, Folder, FolderInput, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ORGANIZE_STAGE_LABELS,
  type OrganizeItemProgress,
  type OrganizeProgress
} from '../../bookmarks/organize-bookmarks';
import { organizationPathKey } from '../../bookmarks/organization-planner';
import type { ModelProfile } from '../../ai/types';
import type { OrganizationApproval } from '../../bookmarks/organize-bookmarks';
import { OrganizationDuplicatePanel } from './OrganizationDuplicatePanel';
import { OrganizationActivityPanel } from './OrganizationActivityPanel';
import { OrganizationSimilarityPanel } from './OrganizationSimilarityPanel';
import type { OrganizationReviewRecord } from '../../bookmarks/organization-review';
import { similarityKey } from '../../bookmarks/organization-similarity';

const steps = [
  '完整备份',
  '分析标题与网址',
  '规划分类与归属',
  '确认方案',
  '创建目录并移动'
];

export function organizeProgressText(progress: OrganizeProgress): string {
  const label = ORGANIZE_STAGE_LABELS[progress.stage];
  if (progress.stage === 'failed')
    return `${ORGANIZE_STAGE_LABELS[progress.stoppedStage ?? 'backup']}未完成，整理已停止`;
  if (progress.stage === 'reviewing')
    return `${label}：已记录 ${progress.similarities?.length ?? 0} 对相似项，默认全部保留`;
  if (progress.stage === 'reading' || progress.stage === 'assigning')
    return `${label}：${progress.stage === 'reading' ? progress.read : progress.assigned} / ${progress.total}${progress.batch ? ` · 第 ${progress.batch} / ${progress.batchTotal} 批` : ''}`;
  if (progress.stage === 'creating')
    return `${label}：已新建 ${progress.createdFolders} 个目录`;
  if (progress.stage === 'moving')
    return `${label}：${progress.completed + progress.failed} / ${progress.total}`;
  if (progress.stage === 'completed')
    return `整理完成：${progress.completed} 成功，${progress.failed} 未完成，${progress.skipped} 跳过${progress.recycled ? `，${progress.recycled} 个副本已回收` : ''}${progress.recycleFailed ? `，${progress.recycleFailed} 个副本未回收` : ''}`;
  return label;
}
export function organizationDiagnostic(
  progress: OrganizeProgress,
  model?: Pick<ModelProfile, 'name' | 'model' | 'protocol'>
): string {
  const batches = (progress.batches ?? []).map((batch) => {
    const seconds = batch.startedAt
      ? Math.max(
          0,
          Math.floor(
            ((batch.finishedAt ?? Date.now()) - batch.startedAt) / 1000
          )
        )
      : 0;
    return [
      batch.stage,
      String(batch.batch),
      batch.status,
      batch.attempt > 1 ? `第${batch.attempt}次` : '',
      `${seconds}秒`,
      batch.error ?? batch.summary ?? ''
    ]
      .filter(Boolean)
      .join(' ');
  });
  return [
    'Siftmark 整理诊断',
    model ? `模型: ${model.name} / ${model.model} / ${model.protocol}` : '',
    `阶段: ${progress.stoppedStage ?? progress.stage}`,
    `错误: ${progress.pipelineError ?? ''}`,
    `范围: ${progress.total}`,
    progress.backupFilename ? `备份: ${progress.backupFilename}` : '',
    '批次:',
    ...batches
  ]
    .filter(Boolean)
    .join('\n');
}

function stepIndex(progress: OrganizeProgress): number {
  return {
    backup: 0,
    flattening: 1,
    reading: 1,
    planning: 2,
    assigning: 2,
    reviewing: 2,
    preview: 3,
    creating: 4,
    moving: 4,
    completed: 5,
    cancelled: 3,
    failed: 0
  }[
    progress.stage === 'failed'
      ? (progress.stoppedStage ?? 'backup')
      : progress.stage
  ];
}

function itemStatus(
  item: OrganizeItemProgress,
  stage: OrganizeProgress['stage']
): string {
  if (item.status === 'completed')
    return item.action === 'recycled'
      ? '副本已移入回收站'
      : item.action === 'kept'
        ? '已在目标目录'
        : '已移动';
  if (item.status === 'failed') return '未完成 · 保留当前状态';
  if (item.status === 'running')
    return item.phase === 'validating' ? '检查书签与目录' : '正在移动';
  if (stage === 'failed' || stage === 'cancelled') return '未执行移动';
  if (item.duplicateOf) return '同 URL 副本 · 待确认后回收';
  return item.selectedFolderPath ? '已规划 · 待确认或执行' : '等待规划';
}

function inside(path: string[] | undefined, parent: string[]): boolean {
  return Boolean(
    path &&
    path.length >= parent.length &&
    organizationPathKey(path.slice(0, parent.length)) ===
      organizationPathKey(parent)
  );
}

export function OrganizationProcessDialog({
  progress,
  model,
  onClose,
  similarityRecords = [],
  onReviewSimilarities,
  onConfirm,
  onRetry,
  onRetryFailed
}: {
  progress: OrganizeProgress;
  model?: ModelProfile;
  onClose: () => void;
  similarityRecords?: OrganizationReviewRecord[];
  onReviewSimilarities?: () => void;
  onConfirm: (approved: boolean | OrganizationApproval) => void;
  onRetry?: () => void;
  onRetryFailed?: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [diagnostic, setDiagnostic] = useState('');
  const canResume = (progress.batches ?? []).some(
    (batch) => batch.status === 'completed'
  );
  // 整理完成后书签已经移动，只有失败或取消的任务才允许重新分析，避免误点重跑已完成的任务。
  const retryable = progress.stage === 'failed' || progress.stage === 'cancelled';
  const ignoredSimilarities = (progress.batches ?? []).reduce(
    (count, batch) => count + (batch.ignoredSimilarities ?? 0),
    0
  );
  const [tab, setTab] = useState<
    'activity' | 'taxonomy' | 'items' | 'duplicates' | 'similarities'
  >(
    ['preview', 'completed', 'cancelled', 'failed'].includes(progress.stage)
      ? 'taxonomy'
      : 'activity'
  );
  const [keepers, setKeepers] = useState<Record<string, string>>({});
  const duplicates = progress.duplicates ?? [];
  const duplicateCount = duplicates.reduce(
    (sum, group) => sum + group.bookmarks.length - 1,
    0
  );
  const currentSimilarityIds = new Set(
    (progress.similarities ?? []).map((pair) => similarityKey(pair.bookmarkIds))
  );
  const currentSimilarities = similarityRecords.filter((record) =>
    currentSimilarityIds.has(record.id)
  );
  const tabs = [
    { id: 'activity', label: '分析过程' },
    { id: 'taxonomy', label: '分类方案' },
    { id: 'items', label: `书签明细 · ${progress.total}` },
    ...(currentSimilarities.length
      ? [
          {
            id: 'similarities',
            label: `疑似相似 · ${currentSimilarities.length}`
          }
        ]
      : []),
    ...(duplicates.length
      ? [{ id: 'duplicates', label: `同 URL 重复 · ${duplicateCount}` }]
      : [])
  ] as const;
  const [filter, setFilter] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [mobileDetail, setMobileDetail] = useState(false);
  const [now, setNow] = useState(Date.now());
  const waiting = ['reading', 'planning', 'assigning', 'reviewing'].includes(
    progress.stage
  );
  const terminal = ['completed', 'failed', 'cancelled'].includes(
    progress.stage
  );
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }, []);
  useEffect(() => {
    if (!waiting) return;
    setNow(Date.now());
    const timer = globalThis.setInterval(() => setNow(Date.now()), 1000);
    return () => globalThis.clearInterval(timer);
  }, [waiting, progress.stageStartedAt]);

  const directories = useMemo(() => {
    const paths = new Map<string, { path: string[]; purpose: string }>();
    for (const folder of progress.folders) {
      for (let depth = 1; depth <= folder.path.length; depth += 1) {
        const path = folder.path.slice(0, depth);
        const key = organizationPathKey(path);
        paths.set(key, {
          path,
          purpose:
            depth === folder.path.length
              ? folder.purpose
              : (paths.get(key)?.purpose ?? '')
        });
      }
    }
    return [...paths.values()].sort((a, b) =>
      a.path.join(' / ').localeCompare(b.path.join(' / '), 'zh-CN')
    );
  }, [progress.folders]);
  const folderCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of progress.items) {
      if (item.duplicateOf) continue;
      for (
        let depth = 1;
        depth <= (item.selectedFolderPath?.length ?? 0);
        depth += 1
      ) {
        const key = organizationPathKey(
          item.selectedFolderPath!.slice(0, depth)
        );
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    return counts;
  }, [progress.items]);
  const newPaths = new Set(progress.newFolderPaths.map(organizationPathKey));
  const visibleItems = progress.items.filter(
    (item) => !filter.length || inside(item.selectedFolderPath, filter)
  );
  const selected =
    visibleItems.find((item) => item.bookmarkId === selectedId) ??
    visibleItems[0];
  const moved = progress.items.filter((item) => item.action === 'moved').length;
  const stageIndex = stepIndex(progress);
  const preview = progress.stage === 'preview';
  useEffect(() => {
    if (preview) setTab('taxonomy');
  }, [preview]);
  const openFolder = (path: string[]) => {
    setFilter(path);
    setSelectedId('');
    setMobileDetail(false);
    setTab('items');
  };

  return (
    <dialog
      ref={dialogRef}
      className="organize-process-dialog"
      aria-labelledby="organize-process-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header>
        <div>
          <h2 id="organize-process-title">
            {preview ? '确认分类方案' : 'AI 整理'}
          </h2>
          <p aria-live="polite">{organizeProgressText(progress)}</p>
          <span className="organize-process-meta">
            {model?.name} · {model?.model} ·{' '}
            {progress.backupFilename || '备份下载中'}
          </span>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="关闭 AI 整理过程"
          title={terminal ? '关闭' : '隐藏窗口，任务保留；可从管理器重新打开'}
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </header>
      <div className="organize-pipeline">
        <ol aria-label="整理流水线">
          {steps.map((label, index) => (
            <li
              key={label}
              data-state={
                index < stageIndex
                  ? 'completed'
                  : index === stageIndex
                    ? progress.stage === 'failed'
                      ? 'failed'
                      : 'current'
                    : 'pending'
              }
            >
              <span>
                {index < stageIndex ? <CheckCircle2 size={14} /> : index + 1}
              </span>
              <strong>{label}</strong>
            </li>
          ))}
        </ol>
        {waiting ? (
          <p className="organize-wait">
            等待模型返回 · 当前阶段已用{' '}
            {Math.max(0, Math.floor((now - progress.stageStartedAt) / 1000))} 秒
          </p>
        ) : null}
        {progress.pipelineError ? (
          <p role="alert" className="organize-pipeline-error">
            {progress.pipelineError}
          </p>
        ) : null}
        {ignoredSimilarities > 0 ? (
          <p className="organize-wait">
            {ignoredSimilarities}{' '}
            条相似建议未通过校验，已忽略；不会据此回收书签。
          </p>
        ) : null}
      </div>
      <dl className="organize-overview">
        <div>
          <dt>本次范围</dt>
          <dd>
            {progress.total} 条<span>另有 {progress.skipped} 条跳过</span>
          </dd>
        </div>
        <div>
          <dt>{terminal ? '实际移动' : '预计移动'}</dt>
          <dd>
            {terminal
              ? moved
              : progress.stage === 'preview' || stageIndex > 3
                ? progress.moveCount
                : '—'}{' '}
            条
          </dd>
        </div>
        <div>
          <dt>{terminal ? '已新建目录' : '预计新增目录'}</dt>
          <dd>
            {terminal
              ? progress.createdFolders
              : stageIndex >= 3
                ? progress.newFolderPaths.length
                : '—'}{' '}
            个
          </dd>
        </div>
        <div>
          <dt>执行情况</dt>
          <dd>
            {progress.stage === 'failed'
              ? '已停止'
              : progress.failed
                ? `${progress.failed} 条未完成`
                : progress.stage === 'completed'
                  ? '已完成'
                  : preview
                    ? '尚未改动'
                    : progress.stage === 'cancelled'
                      ? '已取消'
                      : '处理中'}
          </dd>
        </div>
      </dl>
      <div
        className="organize-view-tabs"
        role="tablist"
        aria-label="整理视图"
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key))
            return;
          event.preventDefault();
          const index = tabs.findIndex((item) => item.id === tab);
          const next = tabs[
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? tabs.length - 1
                : (index + (event.key === 'ArrowLeft' ? -1 : 1) + tabs.length) %
                  tabs.length
          ]!.id as typeof tab;
          setTab(next);
          document.getElementById(`organize-${next}-tab`)?.focus();
        }}
      >
        {tabs.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            tabIndex={tab === id ? 0 : -1}
            id={`organize-${id}-tab`}
            aria-controls={`organize-${id}-panel`}
            aria-selected={tab === id}
            onClick={() => setTab(id as typeof tab)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'activity' ? (
        <OrganizationActivityPanel
          batches={progress.batches ?? []}
          now={now}
          concurrency={progress.concurrency ?? 2}
          stage={progress.stage}
        />
      ) : tab === 'taxonomy' ? (
        <section
          className="organize-taxonomy-panel"
          role="tabpanel"
          id="organize-taxonomy-panel"
          aria-labelledby="organize-taxonomy-tab"
        >
          {directories.length ? (
            <table className="organize-taxonomy-table">
              <thead>
                <tr>
                  <th>分类目录</th>
                  <th>书签</th>
                  <th>目录状态</th>
                </tr>
              </thead>
              <tbody>
                {directories.map(({ path, purpose }) => {
                  const key = organizationPathKey(path);
                  const count = folderCounts.get(key) ?? 0;
                  return (
                    <tr key={key}>
                      <td>
                        <button
                          type="button"
                          onClick={() => openFolder(path)}
                          style={{ paddingLeft: 12 + (path.length - 1) * 20 }}
                        >
                          <Folder size={16} />
                          <span>
                            <strong>{path.at(-1)}</strong>
                            {purpose ? <small>{purpose}</small> : null}
                          </span>
                        </button>
                      </td>
                      <td>
                        {progress.assigned
                          ? `${count} 条`
                          : terminal
                            ? '未确定'
                            : '待归属'}
                      </td>
                      <td>
                        {terminal && stageIndex < 4
                          ? '未执行'
                          : stageIndex < 3
                            ? '规划中'
                            : !count
                              ? '不使用'
                              : newPaths.has(key)
                                ? terminal && progress.stage === 'completed'
                                  ? '已新建'
                                  : '新增'
                                : '复用'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="organize-process-empty">
              <Folder size={24} />
              <p>
                {progress.stage === 'failed'
                  ? '没有可执行的分类方案'
                  : '分类方案尚未生成'}
              </p>
            </div>
          )}
        </section>
      ) : tab === 'duplicates' ? (
        <OrganizationDuplicatePanel
          groups={duplicates}
          selections={keepers}
          editable={preview}
          onSelect={(groupId, bookmarkId) =>
            setKeepers((value) => ({ ...value, [groupId]: bookmarkId }))
          }
        />
      ) : tab === 'similarities' ? (
        <OrganizationSimilarityPanel records={currentSimilarities} />
      ) : (
        <section
          className="organize-items-panel"
          role="tabpanel"
          id="organize-items-panel"
          aria-labelledby="organize-items-tab"
          data-mobile-detail={mobileDetail}
        >
          <div className="organize-item-browser">
            <div className="organize-item-filter">
              <strong>
                {filter.join(' / ') || '全部书签'} · {visibleItems.length}
              </strong>
              {filter.length ? (
                <button
                  type="button"
                  onClick={() => {
                    setFilter([]);
                    setMobileDetail(false);
                  }}
                >
                  全部
                </button>
              ) : null}
            </div>
            <nav className="organize-process-list" aria-label="整理队列">
              {visibleItems.map((item) => (
                <button
                  key={item.bookmarkId}
                  type="button"
                  data-selected={item.bookmarkId === selected?.bookmarkId}
                  aria-current={
                    item.bookmarkId === selected?.bookmarkId
                      ? 'true'
                      : undefined
                  }
                  onClick={() => {
                    setSelectedId(item.bookmarkId);
                    setMobileDetail(true);
                  }}
                >
                  <span
                    className={`organize-item-status organize-item-status-${item.status}`}
                    aria-hidden="true"
                  />
                  <span>
                    <strong>{item.title || item.url}</strong>
                    <small>{itemStatus(item, progress.stage)}</small>
                  </span>
                </button>
              ))}
            </nav>
          </div>
          <section className="organize-process-detail">
            <button
              type="button"
              className="organize-detail-back"
              onClick={() => setMobileDetail(false)}
            >
              <ArrowLeft size={16} />
              返回书签列表
            </button>
            {selected ? (
              <>
                <div className="organize-detail-heading">
                  <div>
                    <span className="organize-detail-kicker">
                      {itemStatus(selected, progress.stage)}
                    </span>
                    <h3>{selected.title || '未命名书签'}</h3>
                    <a href={selected.url} target="_blank" rel="noreferrer">
                      {selected.url}
                    </a>
                  </div>
                </div>
                <dl className="organize-detail-facts">
                  <div>
                    <dt>原目录</dt>
                    <dd>{selected.sourceFolderPath.join(' / ') || '书签栏'}</dd>
                  </div>
                  <div>
                    <dt>方案归属</dt>
                    <dd>
                      {selected.selectedFolderPath?.join(' / ') || '尚未确定'}
                    </dd>
                  </div>
                  <div>
                    <dt>执行结果</dt>
                    <dd>
                      {selected.destinationPath?.join(' / ') || '未执行移动'}
                    </dd>
                  </div>
                </dl>
                <div className="organize-detail-block">
                  <h4>分类依据</h4>
                  <p>{selected.summary || '尚未返回'}</p>
                  <p className="organize-detail-reason">{selected.reason}</p>
                  {selected.confidence ? (
                    <p className="organize-detail-reason">
                      模型自评：
                      {selected.confidence === 'high'
                        ? '较确定'
                        : selected.confidence === 'medium'
                          ? '一般'
                          : '不确定'}
                    </p>
                  ) : null}
                  {selected.error ? (
                    <p role="alert" className="organize-pipeline-error">
                      {selected.error}
                    </p>
                  ) : null}
                </div>
              </>
            ) : (
              <p>本分类暂无书签</p>
            )}
          </section>
        </section>
      )}
      <footer className="organize-process-footer">
        <p>
          {preview
            ? '新分类位于书签栏。旧目录不删除；相同路径会复用，名称不同会新增。'
            : progress.stage === 'failed'
              ? progress.createdFolders || moved
                ? `已新建 ${progress.createdFolders} 个目录、移动 ${moved} 条。已完成的改动不会自动撤销。`
                : `书签与目录均未改动；${progress.backupFilename ? '备份已保留' : '备份未完成'}。`
              : terminal
                ? '备份已保留，原标题与网址未改写。'
                : '隐藏窗口不会停止任务；关闭管理器页面会中断后续处理。'}
        </p>
        {!preview &&
        ((terminal && currentSimilarities.length && onReviewSimilarities) ||
          (onRetry &&
            (progress.stage === 'failed' ||
              progress.stage === 'cancelled'))) ? (
          <div>
            {terminal && currentSimilarities.length && onReviewSimilarities ? (
              <button type="button" onClick={onReviewSimilarities}>
                处理相似项
              </button>
            ) : null}
            {retryable && onRetryFailed && canResume ? (
              <button type="button" className="primary" onClick={onRetryFailed}>
                重试失败批次
              </button>
            ) : null}
            {retryable && onRetry ? (
              <button
                type="button"
                className={canResume ? undefined : 'primary'}
                onClick={onRetry}
              >
                重新整理
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                const text = organizationDiagnostic(progress, model);
                setDiagnostic(text);
                void navigator.clipboard
                  ?.writeText(text)
                  .catch(() => undefined);
              }}
            >
              复制诊断
            </button>
          </div>
        ) : null}
        {diagnostic ? (
          <textarea
            className="organize-diagnostic"
            readOnly
            aria-label="整理诊断"
            value={diagnostic}
            onFocus={(event) => event.currentTarget.select()}
          />
        ) : null}
        {preview ? (
          <div>
            <button type="button" onClick={() => onConfirm(false)}>
              取消，不移动
            </button>
            <button
              type="button"
              className="primary"
              onClick={() =>
                onConfirm(
                  duplicates.length
                    ? { approved: true, keepBookmarkIds: keepers }
                    : true
                )
              }
            >
              <FolderInput size={16} />
              确认并移动 {progress.moveCount} 条
              {duplicateCount ? `，回收 ${duplicateCount} 个副本` : ''}
            </button>
          </div>
        ) : null}
      </footer>
    </dialog>
  );
}
