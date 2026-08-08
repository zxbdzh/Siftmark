import { MousePointerClick } from 'lucide-react';
import { useEffect, useState } from 'react';

const FLOATING_BUTTON_KEY = 'siftmark.content.floating';

export interface FloatingButtonStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export function FloatingButtonStep({
  storage = browser.storage.local
}: {
  storage?: FloatingButtonStorageArea;
}) {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    void storage
      .get(FLOATING_BUTTON_KEY)
      .then((value) => setEnabled(value[FLOATING_BUTTON_KEY] === true));
  }, [storage]);
  return (
    <div className="onboarding-choice">
      <label className="onboarding-toggle">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => {
            const next = event.target.checked;
            setEnabled(next);
            void storage.set({ [FLOATING_BUTTON_KEY]: next });
          }}
        />
        <MousePointerClick size={16} />
        在网页右下角显示保存按钮
      </label>
      <p>默认关闭。关闭后仍可使用扩展弹窗和快捷键保存。</p>
    </div>
  );
}
