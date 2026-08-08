import type { BrowserTab, SaveService } from '../../bookmarks/save-service';
export function TabBatchSave({ service, tabs }: { service: SaveService; tabs: BrowserTab[] }) { return <button type="button" onClick={() => void service.saveTabs(tabs)}>保存当前窗口标签页</button>; }
