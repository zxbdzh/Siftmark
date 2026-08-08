import {
  Archive,
  FolderPlus,
  HeartPulse,
  RotateCcw,
  Trash2
} from 'lucide-react';

interface FolderContextMenuProps {
  onCreate(): void;
  onHealth(): void;
  healthDisabledReason?: string;
  onArchive?(): void;
  archiveLabel?: string;
  archiveDisabledReason?: string;
  onRecycle?(): void;
  recycleLabel?: string;
  recycleDisabledReason?: string;
  onRestore?(): void;
  restoreLabel?: string;
}

export function FolderContextMenu(props: FolderContextMenuProps) {
  return (
    <menu aria-label="文件夹操作">
      <button type="button" onClick={props.onCreate}>
        <FolderPlus size={15} />
        新建子文件夹
      </button>
      <button
        type="button"
        onClick={props.onHealth}
        disabled={Boolean(props.healthDisabledReason)}
        title={props.healthDisabledReason}
      >
        <HeartPulse size={15} />
        健康检查
      </button>
      {props.onRestore ? (
        <button type="button" onClick={props.onRestore}>
          <RotateCcw size={15} />
          {props.restoreLabel ?? '恢复到原位置'}
        </button>
      ) : (
        <>
          <button
            type="button"
            onClick={props.onArchive}
            disabled={!props.onArchive || Boolean(props.archiveDisabledReason)}
            title={props.archiveDisabledReason}
          >
            <Archive size={15} />
            {props.archiveLabel ?? '归档'}
          </button>
          <button
            type="button"
            onClick={props.onRecycle}
            disabled={!props.onRecycle || Boolean(props.recycleDisabledReason)}
            title={props.recycleDisabledReason}
          >
            <Trash2 size={15} />
            {props.recycleLabel ?? '移到回收站'}
          </button>
        </>
      )}
    </menu>
  );
}
