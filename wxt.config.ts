import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    build: {
      // Chrome treats extension-page module preloads as a different execution world.
      modulePreload: false
    }
  }),
  manifest: {
    name: '__MSG_extensionName__',
    description: '__MSG_extensionDescription__',
    default_locale: 'zh_CN',
    permissions: ['bookmarks', 'storage', 'tabs', 'scripting', 'contextMenus', 'alarms', 'sidePanel'],
    optional_permissions: ['notifications'],
    host_permissions: ['<all_urls>'],
    action: { default_title: 'Siftmark' },
    side_panel: { default_path: 'sidepanel.html' },
    commands: { 'save-current-page': { suggested_key: { default: 'Ctrl+Shift+S', mac: 'Command+Shift+S' }, description: '保存当前页面' } },
    incognito: 'spanning'
  }
});
