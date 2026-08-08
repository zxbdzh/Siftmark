import { FileUp } from 'lucide-react';
import type { ReactNode } from 'react';

export function MigrationStep({ children }: { children?: ReactNode }) {
  return (
    <div className="onboarding-choice">
      <p>
        <FileUp size={16} />
        导入只处理用户主动选择的本地文件，并在写入书签前显示预览和冲突。
      </p>
      {children ?? <p>可稍后在“备份与迁移”中导入。</p>}
    </div>
  );
}
