import { Save, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  defaultSmartBookmarkSettings,
  smartBookmarkFolderLevelBounds,
  type ChromeSettingsRepository,
  type SmartBookmarkSettings
} from '../../settings/settings-repository';

export function BookmarkPreferencesSection({
  repository
}: {
  repository: ChromeSettingsRepository;
}) {
  const [settings, setSettings] = useState<SmartBookmarkSettings>(
    defaultSmartBookmarkSettings
  );
  const [status, setStatus] = useState('');

  useEffect(() => {
    void repository.getSmartBookmarkSettings().then((storedSettings) => {
      setSettings(storedSettings);
    });
  }, [repository]);

  const save = async () => {
    await repository.setSmartBookmarkSettings(settings);
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
            <small>AI 可按下方上限补建目录；任何新建操作都需要批准。</small>
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
        <label className="preference-row range-row">
          <span>
            <strong>单次最多新建层级</strong>
            <small>相对最深的已有目录，一次最多连续补建几级。</small>
          </span>
          <span className="range-control">
            <input
              type="range"
              aria-label="单次最多新建层级"
              min={smartBookmarkFolderLevelBounds.min}
              max={smartBookmarkFolderLevelBounds.max}
              step="1"
              disabled={!settings.allowNewFolders}
              value={settings.maxNewFolderLevels}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  maxNewFolderLevels: Number(event.target.value)
                })
              }
            />
            <output>{settings.maxNewFolderLevels} 级</output>
          </span>
        </label>
        <label className="preference-row range-row">
          <span>
            <strong>推荐目录深度</strong>
            <small>优先整理到第几级目录，不计算书签栏根目录。</small>
          </span>
          <span className="range-control">
            <input
              type="range"
              aria-label="推荐目录深度"
              min={smartBookmarkFolderLevelBounds.min}
              max={smartBookmarkFolderLevelBounds.max}
              step="1"
              value={settings.preferredFolderDepth}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  preferredFolderDepth: Number(event.target.value)
                })
              }
            />
            <output>{settings.preferredFolderDepth} 级</output>
          </span>
        </label>
        <label className="preference-row">
          <span>
            <strong>接管浏览器原生收藏</strong>
            <small>使用浏览器收藏按钮后自动整理，风险操作会请求批准。</small>
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
          <span className="range-control">
            <input
              type="range"
              aria-label="标题长度"
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
            <output>{settings.renameMaxLength}</output>
          </span>
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
