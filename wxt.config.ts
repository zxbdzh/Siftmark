import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Siftmark',
    description: 'AI bookmark manager',
    default_locale: 'zh_CN',
    permissions: ['bookmarks', 'storage', 'tabs', 'scripting', 'contextMenus', 'alarms'],
    optional_permissions: ['notifications'],
    host_permissions: ['<all_urls>'],
    action: { default_title: 'Siftmark' },
    incognito: 'spanning'
  }
});
