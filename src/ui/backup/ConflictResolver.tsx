import type { ImportConflict } from '../../backup/conflict-detector';
import type { ImportDecision } from '../../backup/import-plan';
import type { ImportNode } from '../../backup/types';

interface ConflictResolverProps {
  conflict: ImportConflict;
  node: ImportNode;
  decision: ImportDecision;
  onChange: (decision: ImportDecision) => void;
}

export function ConflictResolver({
  conflict,
  node,
  decision,
  onChange
}: ConflictResolverProps) {
  return (
    <li className="conflict-row">
      <div>
        <strong>{node.title}</strong>
        <span>{conflictLabel(conflict.kind)}</span>
      </div>
      <label>
        <span className="visually-hidden">{node.title} 的处理方式</span>
        <select
          aria-label={`${node.title} 的处理方式`}
          value={decision}
          onChange={(event) => onChange(event.target.value as ImportDecision)}
        >
          <option value="keep-existing">保留现有</option>
          <option value="skip">跳过此项</option>
          <option value="create-duplicate">创建副本</option>
          {conflict.kind === 'metadata-only' ? (
            <option value="merge-metadata">合并标签与笔记</option>
          ) : null}
        </select>
      </label>
    </li>
  );
}

function conflictLabel(kind: ImportConflict['kind']): string {
  if (kind === 'exact-url') return 'URL 完全相同';
  if (kind === 'normalized-url') return '移除跟踪参数后 URL 相同';
  if (kind === 'folder-title') return '存在同名文件夹';
  if (kind === 'duplicate-source-node') return '源文件包含重复节点';
  return '仅元数据不同';
}
