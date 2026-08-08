import type { ReactNode } from 'react';

export function ModelStep({ children }: { children?: ReactNode }) {
  return (
    <div className="onboarding-choice">
      <p>模型配置可选；未配置时，本地整理、搜索、备份和健康检查仍可使用。</p>
      {children ?? <p>可稍后在设置的“模型档案”中配置。</p>}
    </div>
  );
}
