import { Save, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  defaultSmartBookmarkSettings,
  type ChromeSettingsRepository,
  type SmartBookmarkSettings
} from '../../settings/settings-repository';

const FLOATING_BUTTON_KEY = 'siftmark.content.floating';

export function BookmarkPreferencesSection({
  repository
}: {
  repository: ChromeSettingsRepository;
}) {
  const [settings, setSettings] = useState<SmartBookmarkSettings>(
    defaultSmartBookmarkSettings
  );
  const [floatingButton, setFloatingButton] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    void Promise.all([
      repository.getSmartBookmarkSettings(),
      browser.storage.local.get(FLOATING_BUTTON_KEY)
    ]).then(([storedSettings, storedFloating]) => {
      setSettings(storedSettings);
      setFloatingButton(storedFloating[FLOATING_BUTTON_KEY] === true);
    });
  }, [repository]);

  const save = async () => {
    await Promise.all([
      repository.setSmartBookmarkSettings(settings),
      browser.storage.local.set({ [FLOATING_BUTTON_KEY]: floatingButton })
    ]);
    setStatus('智能收藏偏好已保存');
  };

  return (
    <section className="bookmark-preferences-section">
      <div className="section-title-row">
        <Sparkles size={20} />
        <div>
          <h2>智能收藏</h2>
          <p>控制一键收藏时的分类、目录创建和标题处理方式。</p>
        </div>
      </div>
      <div className="preference-list">
        <label className="preference-row">
          <span>
            <strong>允许创建新文件夹</strong>
            <small>现有目录不合适时，允许 AI 创建最多三级目录。</small>
          </span>
          <input
            type="checkbox"
            checked={settings.allowNewFolders}
            onChange={(event) =>
              setSettings({ ...settings, allowNewFolders: event.target.checked })
            }
          />
        </label>
        <div className="preference-row">
          <span>
            <strong>新目录策略</strong>
            <small>越积极，AI 越倾向于建立新的细分类目。</small>
          </span>
          <div className="segmented-control" aria-label="新目录策略">
            {([
              ['weak', '保守'],
              ['medium', '平衡'],
              ['strong', '积极']
            ] as const).map(([value, label]) => (
              <button
                type="button"
                key={value}
                disabled={!settings.allowNewFolders}
                data-active={settings.folderCreationLevel === value}
                onClick={() =>
                  setSettings({ ...settings, folderCreationLevel: value })
                }
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <label className="preference-row">
          <span>
            <strong>网页悬浮收藏按钮</strong>
            <small>刷新网页后显示可拖动的一键收藏按钮。</small>
          </span>
          <input
            type="checkbox"
            checked={floatingButton}
            onChange={(event) => setFloatingButton(event.target.checked)}
          />
        </label>
        <label className="preference-row">
          <span>
            <strong>接管浏览器原生收藏</strong>
            <small>使用浏览器收藏按钮创建书签后自动执行 AI 整理。</small>
          </span>
          <input
            type="checkbox"
            checked={settings.captureNativeBookmarks}
            onChange={(event) =>
              setSettings({
                ...settings,
                captureNativeBookmarks: event.target.checked
              })
            }
          />
        </label>
        <label className="preference-row">
          <span>
            <strong>智能重命名</strong>
            <small>收藏时根据网页内容生成便于浏览的短标题。</small>
          </span>
          <input
            type="checkbox"
            checked={settings.smartRename}
            onChange={(event) =>
              setSettings({ ...settings, smartRename: event.target.checked })
            }
          />
        </label>
        <label className="preference-row range-row">
          <span>
            <strong>标题长度</strong>
            <small>建议标题长度：{settings.renameMaxLength} 个字符。</small>
          </span>
          <input
            type="range"
            min="6"
            max="30"
            step="1"
            disabled={!settings.smartRename}
            value={settings.renameMaxLength}
            onChange={(event) =>
              setSettings({
                ...settings,
                renameMaxLength: Number(event.target.value)
              })
            }
          />
        </label>
      </div>
      <div className="section-actions">
        <button type="button" className="primary-button" onClick={() => void save()}>
          <Save size={16} />
          保存偏好
        </button>
        <output aria-live="polite">{status}</output>
      </div>
    </section>
  );
}
