import { ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import type { ImportConflict } from '../../backup/conflict-detector';
import type { ImportDecision } from '../../backup/import-plan';
import type { ImportGraph } from '../../backup/types';
import { ConflictResolver } from './ConflictResolver';

interface ImportPreviewProps {
  graph: ImportGraph;
  conflicts: ImportConflict[];
  onConfirm: (decisions: Record<string, ImportDecision>) => void;
}

export function ImportPreview({
  graph,
  conflicts,
  onConfirm
}: ImportPreviewProps) {
  const [decisions, setDecisions] = useState<Record<string, ImportDecision>>(
    () =>
      Object.fromEntries(
        conflicts.map((conflict) => [
          conflict.sourceId,
          conflict.defaultDecision
        ])
      )
  );
  const nodes = new Map(graph.nodes.map((node) => [node.sourceId, node]));

  return (
    <div className="import-preview">
      <header>
        <ShieldCheck size={18} />
        <strong>
          {formatLabel(graph.format)} · 版本 {graph.version}
        </strong>
      </header>
      <dl>
        <div>
          <dt>文件夹</dt>
          <dd>{graph.nodes.filter((node) => node.kind === 'folder').length}</dd>
        </div>
        <div>
          <dt>书签</dt>
          <dd>
            {graph.nodes.filter((node) => node.kind === 'bookmark').length}
          </dd>
        </div>
        <div>
          <dt>完整性</dt>
          <dd>{graph.integrity === 'verified' ? '已校验' : '未校验'}</dd>
        </div>
        <div>
          <dt>API Key</dt>
          <dd>{keyPresenceLabel(graph.keyPresence)}</dd>
        </div>
        <div>
          <dt>缩略图</dt>
          <dd>{formatBytes(graph.thumbnailBytes)}</dd>
        </div>
      </dl>
      {graph.unknownFields.length > 0 ? (
        <details open>
          <summary>忽略的未知字段（{graph.unknownFields.length}）</summary>
          <ul>
            {graph.unknownFields.map((field) => (
              <li key={field}>{field}</li>
            ))}
          </ul>
        </details>
      ) : null}
      {conflicts.length > 0 ? (
        <ul className="conflict-list">
          {conflicts.map((conflict) => {
            const node = nodes.get(conflict.sourceId);
            return node ? (
              <ConflictResolver
                key={conflict.id}
                conflict={conflict}
                node={node}
                decision={
                  decisions[conflict.sourceId] ?? conflict.defaultDecision
                }
                onChange={(decision) =>
                  setDecisions((current) => ({
                    ...current,
                    [conflict.sourceId]: decision
                  }))
                }
              />
            ) : null;
          })}
        </ul>
      ) : (
        <p>没有发现冲突</p>
      )}
      <button type="button" onClick={() => onConfirm(decisions)}>
        确认导入方案
      </button>
    </div>
  );
}

function formatLabel(format: ImportGraph['format']): string {
  if (format === 'siftmark') return 'Siftmark';
  if (format === 'markai') return 'MarkAI';
  return '浏览器 HTML';
}

function keyPresenceLabel(keyPresence: ImportGraph['keyPresence']): string {
  if (keyPresence === 'encrypted') return '包含加密 Key';
  if (keyPresence === 'redacted') return '已发现但不会导入';
  return '不包含';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
